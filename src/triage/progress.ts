import { RECALL_TOOL_NAME } from "./recall.js";

/**
 * Translate internal tool names into the investigation narration users see in
 * the live status line. Raw tool names ("Checking GitHub:
 * list_recent_pull_requests") read like debug output; the status line should
 * read like an engineer narrating their investigation.
 */
const TOOL_NARRATION: Record<string, string> = {
  [RECALL_TOOL_NAME]: "Checking past incidents for a match",
  list_recent_commits: "Reviewing recent commits",
  get_commit: "Inspecting a suspect commit",
  get_file_contents: "Reading the affected source",
  list_recent_pull_requests: "Reviewing recently merged pull requests",
  list_open_issues: "Checking open issues",
  list_recent_deployments: "Checking recent deployments",
  list_recent_workflow_runs: "Checking CI runs",
  search_code: "Locating the affected code",
};

export function describeToolCall(name: string | undefined): string {
  if (!name) return "Gathering evidence";
  const known = TOOL_NARRATION[name];
  if (known) return known;
  // MCP-provided tools we don't know by name: make them readable.
  return `Checking GitHub (${name.replace(/_/g, " ")})`;
}

/**
 * Map provider failures to a message a responder can act on. A free-tier LLM
 * quota exhaustion mid-incident must say so — a generic "something went wrong"
 * sends people debugging the wrong thing.
 */
export function friendlyTriageError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/RESOURCE_EXHAUSTED|429|quota/i.test(message)) {
    return "The triage brain hit its API rate limit. Wait a minute and retry — or if this persists, the free-tier daily quota is spent (switch keys or try tomorrow).";
  }
  if (/API key|PERMISSION_DENIED|401|403/i.test(message)) {
    return "The triage brain's API key was rejected — check GEMINI_API_KEY / ANTHROPIC_API_KEY.";
  }
  return "I couldn't complete triage on that one. Try again, or check the repo and token setup.";
}
