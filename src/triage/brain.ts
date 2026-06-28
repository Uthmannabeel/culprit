import type { AppConfig } from "../config.js";
import { GitHubMcpBridge } from "../mcp/githubClient.js";
import { runTriageClaude, type ProgressFn } from "./brainClaude.js";
import { runTriageGemini } from "./brainGemini.js";
import type { TriageRequest, TriageResult } from "./types.js";

export type { ProgressFn } from "./brainClaude.js";

/**
 * Run a triage with whichever LLM provider is configured. This is the single
 * entry point used by the Slack handlers and the MCP server.
 *
 * - `gemini`: free-tier brain, gathers evidence via the GitHub REST API.
 * - `anthropic`: Claude brain, gathers evidence over the GitHub MCP server
 *   (connecting and closing the bridge here so callers don't have to).
 */
export async function runTriage(
  config: AppConfig,
  req: TriageRequest,
  onProgress?: ProgressFn,
): Promise<TriageResult> {
  if (config.LLM_PROVIDER === "gemini") {
    return runTriageGemini(config, req, onProgress);
  }

  const bridge = new GitHubMcpBridge(config);
  try {
    await bridge.connect();
    return await runTriageClaude(config, bridge, req, onProgress);
  } finally {
    await bridge.close();
  }
}
