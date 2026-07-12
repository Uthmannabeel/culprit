import { afterEach, describe, expect, test, vi } from "vitest";
import type { AppConfig } from "../config.js";
import {
  getFileContents,
  listRecentCommits,
  listRecentPullRequests,
  listOpenIssues,
  listRecentDeployments,
  listRecentWorkflowRuns,
  searchCode,
} from "./evidence.js";
import { splitRepo } from "./common.js";

const config = { GITHUB_TOKEN: "test-token" } as AppConfig;

/** Stub global fetch to return a given JSON body with status 200. */
function mockFetchJson(body: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, status: 200, json: async () => body, text: async () => "" }) as unknown as Response),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("listRecentPullRequests", () => {
  test("derives the merged flag from merged_at and maps author/url", async () => {
    mockFetchJson([
      {
        number: 1,
        title: "Refactor payment client",
        state: "closed",
        merged_at: "2026-06-20T10:00:00Z",
        html_url: "https://github.com/o/r/pull/1",
        user: { login: "octocat" },
      },
      { number: 2, title: "WIP", state: "closed", merged_at: null, html_url: "https://github.com/o/r/pull/2", user: null },
    ]);

    const prs = await listRecentPullRequests(config, "o/r");

    expect(prs[0]).toMatchObject({ number: 1, merged: true, author: "octocat" });
    expect(prs[1]).toMatchObject({ merged: false, author: "unknown" });
  });
});

describe("listOpenIssues", () => {
  test("filters out pull requests and normalizes labels", async () => {
    mockFetchJson([
      {
        number: 10,
        title: "Checkout 500s",
        html_url: "https://github.com/o/r/issues/10",
        created_at: "2026-06-25T00:00:00Z",
        user: { login: "reporter" },
        labels: [{ name: "bug" }, "sev1"],
      },
      {
        number: 11,
        title: "A PR masquerading as an issue",
        html_url: "https://github.com/o/r/pull/11",
        created_at: "2026-06-26T00:00:00Z",
        pull_request: { url: "..." },
        user: { login: "dev" },
        labels: [],
      },
    ]);

    const issues = await listOpenIssues(config, "o/r");

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ number: 10, author: "reporter", labels: ["bug", "sev1"] });
  });
});

describe("searchCode", () => {
  test("maps the search items to path/url pairs", async () => {
    mockFetchJson({ items: [{ path: "src/checkout.js", html_url: "https://github.com/o/r/blob/main/src/checkout.js" }] });

    const matches = await searchCode(config, "o/r", "checkout");

    expect(matches).toEqual([{ path: "src/checkout.js", url: "https://github.com/o/r/blob/main/src/checkout.js" }]);
  });

  test("falls back to filename matching when the index has nothing", async () => {
    // First call (code search) returns empty; second call (git tree) matches.
    const responses: unknown[] = [
      {},
      { tree: [{ path: "src/payments.js", type: "blob" }, { path: "docs/notes.md", type: "blob" }] },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => responses.shift(), text: async () => "" }) as unknown as Response),
    );

    const matches = await searchCode(config, "o/r", "payments");
    expect(matches).toEqual([{ path: "src/payments.js", url: "https://github.com/o/r/blob/HEAD/src/payments.js" }]);
  });
});

describe("splitRepo", () => {
  test("accepts owner/repo and encodes the segments", () => {
    expect(splitRepo("acme/store")).toEqual(["acme", "store"]);
  });

  test("rejects path/query injection shapes", () => {
    expect(() => splitRepo("acme")).toThrow(/expected owner\/repo/);
    expect(() => splitRepo("acme/store/extra")).toThrow(/expected owner\/repo/);
    expect(() => splitRepo("acme?per_page=100/store")).toThrow(/expected owner\/repo/);
    expect(() => splitRepo("../etc/passwd")).toThrow(/expected owner\/repo/);
  });
});

describe("getFileContents sensitive-path guard", () => {
  test("refuses secret-looking paths before any network call", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    for (const path of [".env", "config/.env.production", "secrets/api.json", "certs/server.pem", "keys/id_rsa"]) {
      await expect(getFileContents(config, "o/r", path)).rejects.toThrow(/sensitive-looking path/);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("ordinary source paths still read", async () => {
    mockFetchJson({ content: Buffer.from("const x = 1;").toString("base64"), encoding: "base64" });
    await expect(getFileContents(config, "o/r", "src/environment.ts")).resolves.toContain("const x = 1;");
  });
});

describe("listRecentCommits", () => {
  test("maps sha, first message line, author", async () => {
    mockFetchJson([
      {
        sha: "c".repeat(40),
        html_url: "https://github.com/o/r/commit/c",
        commit: { message: "fix: rename key\n\nlong body", author: { date: "2026-06-25T00:00:00Z" } },
        author: { login: "dana" },
      },
    ]);
    const commits = await listRecentCommits(config, "o/r");
    expect(commits[0]).toMatchObject({ sha: "cccccccccc", message: "fix: rename key", author: "dana" });
  });
});

describe("listRecentDeployments", () => {
  test("maps environment, ref, and creator", async () => {
    mockFetchJson([
      { environment: "production", ref: "main", sha: "a".repeat(40), created_at: "2026-06-25T21:00:00Z", creator: { login: "dana" } },
    ]);
    const deploys = await listRecentDeployments(config, "o/r");
    expect(deploys[0]).toMatchObject({ environment: "production", ref: "main", sha: "aaaaaaaaaa", creator: "dana" });
  });
});

describe("listRecentWorkflowRuns", () => {
  test("maps run name, conclusion, and branch", async () => {
    mockFetchJson({
      workflow_runs: [
        { name: "CI", conclusion: "failure", head_branch: "main", head_sha: "b".repeat(40), created_at: "2026-06-25T21:05:00Z", html_url: "https://x/runs/1" },
      ],
    });
    const runs = await listRecentWorkflowRuns(config, "o/r");
    expect(runs[0]).toMatchObject({ name: "CI", conclusion: "failure", branch: "main", sha: "bbbbbbbbbb" });
  });
});
