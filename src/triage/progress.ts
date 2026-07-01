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
  search_code: "Locating the affected code",
};

export function describeToolCall(name: string | undefined): string {
  if (!name) return "Gathering evidence";
  const known = TOOL_NARRATION[name];
  if (known) return known;
  // MCP-provided tools we don't know by name: make them readable.
  return `Checking GitHub (${name.replace(/_/g, " ")})`;
}
