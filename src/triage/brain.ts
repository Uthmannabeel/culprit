import Anthropic from "@anthropic-ai/sdk";
import type { AppConfig } from "../config.js";
import { GitHubMcpBridge } from "../mcp/githubClient.js";
import { TRIAGE_SYSTEM_PROMPT, buildTriageUserMessage } from "./prompt.js";
import { TriageResultSchema, type TriageRequest, type TriageResult } from "./types.js";

/** JSON schema for the finalizer tool — the model calls this exactly once. */
const SUBMIT_TOOL: Anthropic.Tool = {
  name: "submit_triage",
  description:
    "Call this exactly once, when you have gathered enough evidence, to deliver your final triage verdict.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      summary: { type: "string", description: "One-line summary of what is most likely wrong." },
      rootCauseHypothesis: { type: "string", description: "Leading root-cause hypothesis, in plain language." },
      confidence: { type: "number", description: "0-100 confidence in the hypothesis." },
      severity: { type: "string", enum: ["sev1", "sev2", "sev3", "unknown"] },
      suspectedOwner: { type: ["string", "null"], description: "GitHub handle/team that owns the area, or null." },
      evidence: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            kind: { type: "string", enum: ["commit", "pull_request", "issue", "file", "other"] },
            title: { type: "string" },
            url: { type: ["string", "null"] },
            why: { type: "string", description: "Why this evidence supports the hypothesis." },
          },
          required: ["kind", "title", "url", "why"],
        },
      },
      recommendedActions: { type: "array", items: { type: "string" } },
      draftIssue: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          body: { type: "string", description: "Markdown body for a fileable GitHub issue." },
          labels: { type: "array", items: { type: "string" } },
        },
        required: ["title", "body", "labels"],
      },
    },
    required: [
      "summary",
      "rootCauseHypothesis",
      "confidence",
      "severity",
      "suspectedOwner",
      "evidence",
      "recommendedActions",
      "draftIssue",
    ],
  },
};

/** Optional progress callback so the Slack handler can stream status updates. */
export type ProgressFn = (note: string) => void | Promise<void>;

/**
 * Runs the agentic triage loop: Claude gathers evidence via the GitHub MCP
 * tools, then calls `submit_triage` with its verdict. Returns the validated
 * result. The caller owns the bridge lifecycle (connect/close).
 */
export async function runTriage(
  config: AppConfig,
  bridge: GitHubMcpBridge,
  req: TriageRequest,
  onProgress?: ProgressFn,
): Promise<TriageResult> {
  const anthropic = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });
  const repo = req.repo ?? config.GITHUB_DEFAULT_REPO;
  if (!repo) throw new Error("No repository specified and GITHUB_DEFAULT_REPO is not set.");

  // MCP tool schemas carry `type: "object"` at runtime; cast to the SDK type.
  const tools = [...bridge.getTools(), SUBMIT_TOOL] as Anthropic.Tool[];
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: buildTriageUserMessage(req, repo) },
  ];

  for (let step = 0; step < config.TRIAGE_MAX_STEPS; step++) {
    const forceSubmit = step === config.TRIAGE_MAX_STEPS - 1;
    const response = await anthropic.messages.create({
      model: config.TRIAGE_MODEL,
      max_tokens: 8000,
      thinking: { type: "adaptive" },
      output_config: { effort: "high" },
      system: TRIAGE_SYSTEM_PROMPT,
      tools,
      // On the last allowed step, force the verdict so we always return something.
      tool_choice: forceSubmit ? { type: "tool", name: "submit_triage" } : { type: "auto" },
      messages,
    });

    if (response.stop_reason === "refusal") {
      throw new Error("The triage model declined to analyze this report.");
    }

    const toolUses = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );

    // No tool call and not forced — the model answered in prose; nudge it once.
    if (toolUses.length === 0) {
      messages.push({ role: "assistant", content: response.content });
      messages.push({
        role: "user",
        content: "Please call submit_triage with your final structured verdict now.",
      });
      continue;
    }

    messages.push({ role: "assistant", content: response.content });

    const submit = toolUses.find((t) => t.name === "submit_triage");
    if (submit) {
      return TriageResultSchema.parse(submit.input);
    }

    // Otherwise these are GitHub MCP calls — execute them all and feed back.
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const call of toolUses) {
      await onProgress?.(`Checking GitHub: ${call.name}`);
      const { text, isError } = await bridge.callTool(call.name, (call.input as Record<string, unknown>) ?? {});
      toolResults.push({
        type: "tool_result",
        tool_use_id: call.id,
        content: truncate(text, 8000),
        is_error: isError,
      });
    }
    messages.push({ role: "user", content: toolResults });
  }

  throw new Error("Triage did not converge on a verdict within the step budget.");
}

/** Keep individual tool results from blowing the context budget. */
function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n…[truncated ${text.length - max} chars]`;
}
