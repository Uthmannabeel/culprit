import { z } from "zod";
import type { AppConfig } from "../config.js";
import {
  listRecentCommits,
  getCommit,
  getFileContents,
  listRecentPullRequests,
  listOpenIssues,
  listRecentDeployments,
  listRecentWorkflowRuns,
  searchCode,
} from "../github/evidence.js";
import type { IncidentMemory } from "../memory/store.js";
import type { RecallHit } from "../memory/types.js";
import { EvidenceHub, HUB_LIST_TOOL_NAME, HUB_QUERY_TOOL_NAME, parseHubArgs } from "../mcp/evidenceHub.js";
import { RECALL_TOOL_NAME, recallToModel } from "./recall.js";

/**
 * Shared, typed evidence dispatch — one place both brains route tool calls
 * through, so a new tool is added ONCE and every tool result carries an
 * explicit outcome.
 *
 * The status is the point: an evidence call that *failed* must be
 * distinguishable from one that *succeeded and found nothing*. Returning a bare
 * "Tool X failed: …" string (the old behaviour) let the model read a 403 as
 * "clean" — silently breaking the product's honesty guarantee. Now `error`
 * means "could not check" and the prompt is told to treat it as unchecked.
 */
export type EvidenceStatus = "ok" | "empty" | "error";

export interface EvidenceResult {
  tool: string;
  status: EvidenceStatus;
  /** Present on `ok` — the retrieved evidence. */
  data?: unknown;
  /** Human-readable note on `empty`/`error` (the reason it couldn't be used). */
  note?: string;
}

/** Everything a tool handler might need. Typed as the minimal surface so tests can fake it. */
export interface EvidenceDeps {
  config: AppConfig;
  repo: string;
  memory: Pick<IncidentMemory, "recall">;
  hub: Pick<EvidenceHub, "sources" | "call">;
  /** Recall hits accumulate here so the verdict's prior-incident panel is model-independent. */
  collectedHits: RecallHit[];
}

function isEmpty(data: unknown): boolean {
  if (Array.isArray(data)) return data.length === 0;
  if (typeof data === "string") return data.trim().length === 0;
  return false;
}

export function evidenceOk(tool: string, data: unknown): EvidenceResult {
  return isEmpty(data) ? { tool, status: "empty", note: "checked — nothing found" } : { tool, status: "ok", data };
}

export function evidenceError(tool: string, note: string): EvidenceResult {
  return { tool, status: "error", note };
}

/**
 * Cap on one tool result's serialized size. Without this the Gemini path sent
 * results verbatim (a big merge commit can be hundreds of KB), and the whole
 * history is re-sent every loop step — context cost grew ~quadratically.
 */
export const TOOL_RESULT_MAX_CHARS = 8000;

/** The JSON string the model sees for a tool result — size-capped. */
export function formatEvidenceResult(result: EvidenceResult): string {
  const json = JSON.stringify(result);
  if (json.length <= TOOL_RESULT_MAX_CHARS) return json;
  return `${json.slice(0, TOOL_RESULT_MAX_CHARS)}\n…[truncated ${json.length - TOOL_RESULT_MAX_CHARS} chars]`;
}

/** Run a handler with a validated-args boundary, mapping any throw to a typed error. */
async function runHandler<S extends z.ZodTypeAny>(
  tool: string,
  schema: S,
  rawArgs: Record<string, unknown>,
  run: (args: z.infer<S>) => Promise<unknown>,
): Promise<EvidenceResult> {
  const parsed = schema.safeParse(rawArgs);
  if (!parsed.success) {
    return evidenceError(tool, `invalid arguments: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
  }
  try {
    return evidenceOk(tool, await run(parsed.data));
  } catch (err) {
    return evidenceError(tool, err instanceof Error ? err.message : String(err));
  }
}

const perPage = z.coerce.number().int().positive().max(30).optional();

/** GitHub REST evidence tools (the Gemini path only — Claude gets these over MCP). */
const REST_HANDLERS: Record<string, (rawArgs: Record<string, unknown>, deps: EvidenceDeps) => Promise<EvidenceResult>> = {
  list_recent_commits: (a, d) =>
    runHandler("list_recent_commits", z.object({ perPage, path: z.string().min(1).optional() }), a, (args) =>
      listRecentCommits(d.config, d.repo, args.perPage ?? 12, args.path),
    ),
  list_recent_deployments: (a, d) =>
    runHandler("list_recent_deployments", z.object({ perPage }), a, (args) => listRecentDeployments(d.config, d.repo, args.perPage ?? 5)),
  list_recent_workflow_runs: (a, d) =>
    runHandler("list_recent_workflow_runs", z.object({ perPage }), a, (args) => listRecentWorkflowRuns(d.config, d.repo, args.perPage ?? 10)),
  get_commit: (a, d) =>
    runHandler("get_commit", z.object({ sha: z.string().min(1) }), a, (args) => getCommit(d.config, d.repo, args.sha)),
  get_file_contents: (a, d) =>
    runHandler("get_file_contents", z.object({ path: z.string().min(1) }), a, (args) => getFileContents(d.config, d.repo, args.path)),
  list_recent_pull_requests: (a, d) =>
    runHandler("list_recent_pull_requests", z.object({ state: z.enum(["open", "closed", "all"]).optional(), perPage }), a, (args) =>
      listRecentPullRequests(d.config, d.repo, args.state ?? "closed", args.perPage ?? 10),
    ),
  list_open_issues: (a, d) =>
    runHandler("list_open_issues", z.object({ perPage }), a, (args) => listOpenIssues(d.config, d.repo, args.perPage ?? 10)),
  search_code: (a, d) =>
    runHandler("search_code", z.object({ query: z.string().min(1) }), a, (args) => searchCode(d.config, d.repo, args.query)),
};

/** Dispatch a GitHub-REST evidence tool. Returns null if `name` isn't one. */
export function dispatchGithubRestTool(
  name: string,
  rawArgs: Record<string, unknown>,
  deps: EvidenceDeps,
): Promise<EvidenceResult> | null {
  const handler = REST_HANDLERS[name];
  return handler ? handler(rawArgs, deps) : null;
}

/**
 * Dispatch a tool BOTH brains share — incident-memory recall and the Evidence
 * Hub. Returns null if `name` isn't one of them (so the caller routes it
 * elsewhere: REST for Gemini, the MCP bridge for Claude).
 */
export async function dispatchSharedTool(
  name: string,
  rawArgs: Record<string, unknown>,
  deps: EvidenceDeps,
): Promise<EvidenceResult | null> {
  if (name === RECALL_TOOL_NAME) {
    return runHandler(name, z.object({ query: z.string().min(1) }), rawArgs, async (args) => {
      const hits = await deps.memory.recall(args.query, undefined, deps.repo);
      deps.collectedHits.push(...hits);
      return recallToModel(hits);
    });
  }
  if (name === HUB_LIST_TOOL_NAME) {
    return runHandler(name, z.object({}), rawArgs, () => deps.hub.sources());
  }
  if (name === HUB_QUERY_TOOL_NAME) {
    const parsed = z
      .object({ source: z.string().min(1), tool: z.string().min(1), argsJson: z.string().optional() })
      .safeParse(rawArgs);
    if (!parsed.success) {
      return evidenceError(name, `invalid arguments: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
    }
    try {
      // The hub reports failures via isError — map them to the `error` status
      // so a down source can never read as a clean "nothing found".
      const { text, isError } = await deps.hub.call(
        parsed.data.source,
        parsed.data.tool,
        parseHubArgs(parsed.data.argsJson),
      );
      return isError ? evidenceError(name, text) : evidenceOk(name, text);
    } catch (err) {
      return evidenceError(name, err instanceof Error ? err.message : String(err));
    }
  }
  return null;
}
