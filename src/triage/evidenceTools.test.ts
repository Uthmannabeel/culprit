import { afterEach, describe, expect, test, vi } from "vitest";
import type { AppConfig } from "../config.js";
import type { RecallHit } from "../memory/types.js";
import type { IncidentRecord } from "../memory/types.js";

// Mock the GitHub REST layer — its own tests cover the HTTP; here we test that
// the dispatcher validates args, wraps outcomes, and never leaks a bare error.
vi.mock("../github/evidence.js", () => ({
  listRecentCommits: vi.fn(),
  getCommit: vi.fn(),
  getFileContents: vi.fn(),
  listRecentPullRequests: vi.fn(),
  listOpenIssues: vi.fn(),
  listRecentDeployments: vi.fn(),
  listRecentWorkflowRuns: vi.fn(),
  searchCode: vi.fn(),
}));

import * as evidence from "../github/evidence.js";
import {
  dispatchGithubRestTool,
  dispatchSharedTool,
  evidenceError,
  evidenceOk,
  formatEvidenceResult,
  type EvidenceDeps,
} from "./evidenceTools.js";

function record(id: string): IncidentRecord {
  return {
    id, symptom: `symptom ${id}`, rootCause: "", resolution: "fix", resolvedBy: "dana",
    links: [], repo: "o/r", createdAt: "", hypothesisWasCorrect: null, embedding: null,
  };
}
function hit(id: string, score = 0.8): RecallHit {
  return { record: record(id), score, method: "embedding" };
}

function makeDeps(over: Partial<EvidenceDeps> = {}): EvidenceDeps {
  return {
    config: {} as AppConfig,
    repo: "o/r",
    memory: { recall: vi.fn(async () => []) },
    hub: { sources: vi.fn(async () => []), call: vi.fn(async () => "hub text") },
    collectedHits: [],
    ...over,
  };
}

afterEach(() => vi.clearAllMocks());

describe("outcome envelope", () => {
  test("evidenceOk marks empty arrays/strings as 'empty', data otherwise as 'ok'", () => {
    expect(evidenceOk("t", [{ a: 1 }])).toMatchObject({ status: "ok" });
    expect(evidenceOk("t", [])).toMatchObject({ status: "empty" });
    expect(evidenceOk("t", "   ")).toMatchObject({ status: "empty" });
    expect(evidenceOk("t", "content")).toMatchObject({ status: "ok", data: "content" });
  });

  test("formatEvidenceResult emits the status the model keys off", () => {
    expect(JSON.parse(formatEvidenceResult(evidenceError("t", "boom")))).toEqual({ tool: "t", status: "error", note: "boom" });
  });
});

describe("dispatchGithubRestTool", () => {
  test("valid call → ok with the retrieved data", async () => {
    vi.mocked(evidence.listRecentPullRequests).mockResolvedValue([{ number: 1 }] as never);
    const res = await dispatchGithubRestTool("list_recent_pull_requests", { state: "closed" }, makeDeps());
    expect(res).toMatchObject({ status: "ok", data: [{ number: 1 }] });
  });

  test("a thrown error becomes status:error — NOT a bare 'clean' string (the honesty fix)", async () => {
    vi.mocked(evidence.listOpenIssues).mockRejectedValue(new Error("GitHub 403: forbidden"));
    const res = await dispatchGithubRestTool("list_open_issues", {}, makeDeps());
    expect(res).toEqual({ tool: "list_open_issues", status: "error", note: "GitHub 403: forbidden" });
  });

  test("empty result is 'empty' (checked, nothing found) — distinct from error", async () => {
    vi.mocked(evidence.searchCode).mockResolvedValue([]);
    const res = await dispatchGithubRestTool("search_code", { query: "checkout" }, makeDeps());
    expect(res).toMatchObject({ status: "empty" });
  });

  test("invalid args → error at the boundary, handler never runs", async () => {
    const res = await dispatchGithubRestTool("get_commit", {}, makeDeps()); // sha missing
    expect(res?.status).toBe("error");
    expect(res?.note).toContain("invalid arguments");
    expect(evidence.getCommit).not.toHaveBeenCalled();
  });

  test("unknown REST tool → null so the caller can route it", () => {
    expect(dispatchGithubRestTool("not_a_tool", {}, makeDeps())).toBeNull();
  });
});

describe("dispatchSharedTool", () => {
  test("recall returns hits and accumulates them for the prior-incident panel", async () => {
    const deps = makeDeps({ memory: { recall: vi.fn(async () => [hit("a")]) } });
    const res = await dispatchSharedTool("recall_incident_memory", { query: "checkout 500s" }, deps);
    expect(res).toMatchObject({ status: "ok" });
    expect(deps.collectedHits.map((h) => h.record.id)).toEqual(["a"]);
  });

  test("recall with a missing query errors instead of silently searching for nothing", async () => {
    const deps = makeDeps();
    const res = await dispatchSharedTool("recall_incident_memory", {}, deps);
    expect(res?.status).toBe("error");
    expect(deps.memory.recall).not.toHaveBeenCalled();
  });

  test("hub list/query route to the hub; a non-shared tool returns null", async () => {
    const deps = makeDeps();
    expect((await dispatchSharedTool("list_evidence_sources", {}, deps))?.status).toBe("empty"); // no sources
    const q = await dispatchSharedTool("query_evidence_source", { source: "logs", tool: "search", argsJson: '{"q":"x"}' }, deps);
    expect(q).toMatchObject({ status: "ok", data: "hub text" });
    expect(await dispatchSharedTool("list_recent_commits", {}, deps)).toBeNull();
  });
});
