import Anthropic from "@anthropic-ai/sdk";
import type { AppConfig } from "../config.js";
import { GitHubMcpBridge } from "../mcp/githubClient.js";
import { IncidentMemory } from "../memory/store.js";
import type { RecallHit } from "../memory/types.js";
import {
  EvidenceHub,
  HUB_LIST_TOOL_DESCRIPTION,
  HUB_LIST_TOOL_NAME,
  HUB_QUERY_TOOL_DESCRIPTION,
  HUB_QUERY_TOOL_NAME,
  parseEvidenceServers,
} from "../mcp/evidenceHub.js";
import { TRIAGE_SYSTEM_PROMPT, buildTriageUserMessage } from "./prompt.js";
import { RECALL_TOOL_NAME, RECALL_TOOL_DESCRIPTION, toPriorIncidents } from "./recall.js";
import { dispatchSharedTool, formatEvidenceResult, type EvidenceDeps } from "./evidenceTools.js";
import { describeToolCall } from "./progress.js";
import { SUBMIT_TOOL_ANTHROPIC, SUBMIT_TOOL_NAME } from "./submitTool.js";
import { withRetry } from "../util/retry.js";
import {
  ERR_NO_CONVERGE,
  ERR_NO_REPO,
  TriageResultSchema,
  type ProgressFn,
  type TriageRequest,
  type TriageResult,
} from "./types.js";

/** The Evidence Hub's two generic tools, as Anthropic tool definitions. */
const HUB_TOOLS: Anthropic.Tool[] = [
  {
    name: HUB_LIST_TOOL_NAME,
    description: HUB_LIST_TOOL_DESCRIPTION,
    input_schema: { type: "object", additionalProperties: false, properties: {} },
  },
  {
    name: HUB_QUERY_TOOL_NAME,
    description: HUB_QUERY_TOOL_DESCRIPTION,
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        source: { type: "string", description: "The evidence source name (from list_evidence_sources)." },
        tool: { type: "string", description: "The tool to call on that source." },
        argsJson: { type: "string", description: "The tool's arguments as a JSON object string." },
      },
      required: ["source", "tool"],
    },
  },
];

/** Incident-memory recall as a native Claude tool (mirrors the Gemini path). */
const RECALL_TOOL: Anthropic.Tool = {
  name: RECALL_TOOL_NAME,
  description: RECALL_TOOL_DESCRIPTION,
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: { query: { type: "string", description: "The symptom to match, e.g. 'checkout returning 500s'." } },
    required: ["query"],
  },
};

// The finalizer tool definition is shared with the Gemini brain — see submitTool.ts.

/**
 * Runs the agentic triage loop on Claude: it recalls past incidents, gathers
 * evidence via the GitHub MCP tools, then calls `submit_triage` with its
 * verdict. Returns the validated result. The caller owns the bridge lifecycle.
 */
export async function runTriageClaude(
  config: AppConfig,
  bridge: GitHubMcpBridge,
  req: TriageRequest,
  onProgress?: ProgressFn,
): Promise<TriageResult> {
  const anthropic = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });
  const repo = req.repo ?? config.GITHUB_DEFAULT_REPO;
  if (!repo) throw new Error(ERR_NO_REPO);

  const memory = new IncidentMemory(config);
  const collectedHits: RecallHit[] = [];
  const hub = new EvidenceHub(parseEvidenceServers(config.EVIDENCE_MCP_SERVERS));
  const deps: EvidenceDeps = { config, repo, memory, hub, collectedHits };

  // MCP tool schemas carry `type: "object"` at runtime; cast to the SDK type.
  const tools = [
    ...bridge.getTools(),
    ...(hub.enabled ? HUB_TOOLS : []),
    RECALL_TOOL,
    SUBMIT_TOOL_ANTHROPIC,
  ] as Anthropic.Tool[];
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: buildTriageUserMessage(req, repo) },
  ];

  try {
  for (let step = 0; step < config.TRIAGE_MAX_STEPS; step++) {
    const forceSubmit = step === config.TRIAGE_MAX_STEPS - 1;
    // The API rejects a forced tool_choice while thinking is enabled, so the
    // final "always return something" step must drop thinking — otherwise the
    // safety valve itself 400s after burning the whole step budget.
    // Transient failures (429/529/network) retry with backoff.
    const response = await withRetry(() =>
      anthropic.messages.create({
        model: config.TRIAGE_MODEL,
        max_tokens: 8000,
        ...(forceSubmit ? {} : { thinking: { type: "adaptive" as const } }),
        output_config: { effort: "high" },
        system: TRIAGE_SYSTEM_PROMPT,
        tools,
        // On the last allowed step, force the verdict so we always return something.
        tool_choice: forceSubmit ? { type: "tool", name: SUBMIT_TOOL_NAME } : { type: "auto" },
        messages,
      }),
    );

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

    const submit = toolUses.find((t) => t.name === SUBMIT_TOOL_NAME);
    if (submit) {
      return TriageResultSchema.parse({ ...(submit.input as object), priorIncidents: toPriorIncidents(collectedHits) });
    }

    // One status update per round — N racing chat.updates on the same message
    // would burn Slack rate limit and land in arbitrary order.
    await onProgress?.(describeRound(toolUses.map((t) => t.name)));

    // Otherwise these are recall / GitHub MCP calls — run the round concurrently
    // (Promise.all preserves order, so results stay aligned with tool_use ids).
    const toolResults: Anthropic.ToolResultBlockParam[] = await Promise.all(
      toolUses.map(async (call): Promise<Anthropic.ToolResultBlockParam> => {
        const input = (call.input as Record<string, unknown>) ?? {};
        // Recall + hub go through the shared typed dispatcher (same as Gemini);
        // everything else is a GitHub MCP tool, handled by the bridge, whose
        // is_error flag already gives Claude a first-class success/failure signal.
        const shared = await dispatchSharedTool(call.name, input, deps);
        if (shared) {
          return {
            type: "tool_result",
            tool_use_id: call.id,
            content: formatEvidenceResult(shared),
            is_error: shared.status === "error" ? true : undefined,
          };
        }
        const { text, isError } = await bridge.callTool(call.name, input);
        return { type: "tool_result", tool_use_id: call.id, content: truncate(text, 8000), is_error: isError };
      }),
    );
    messages.push({ role: "user", content: toolResults });
  }

  throw new Error(ERR_NO_CONVERGE);
  } finally {
    await hub.close();
  }
}

/** Narrate a whole tool round as one line, deduped. */
export function describeRound(toolNames: string[]): string {
  return [...new Set(toolNames.map((n) => describeToolCall(n)))].join(" · ");
}

/** Keep individual tool results from blowing the context budget. */
function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n…[truncated ${text.length - max} chars]`;
}
