import { GoogleGenAI, Type, FunctionCallingConfigMode } from "@google/genai";
import type { Content, FunctionDeclaration, Part } from "@google/genai";
import type { AppConfig } from "../config.js";
import { TRIAGE_SYSTEM_PROMPT, buildTriageUserMessage } from "./prompt.js";
import { SUBMIT_TOOL_GEMINI, SUBMIT_TOOL_NAME } from "./submitTool.js";
import {
  ERR_NO_CONVERGE,
  ERR_NO_REPO,
  TriageResultSchema,
  type TriageRequest,
  type TriageResult,
} from "./types.js";
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
import type { ProgressFn } from "./types.js";
import { RECALL_TOOL_NAME, RECALL_TOOL_DESCRIPTION, toPriorIncidents } from "./recall.js";
import {
  dispatchGithubRestTool,
  dispatchSharedTool,
  evidenceError,
  formatEvidenceResult,
  type EvidenceDeps,
} from "./evidenceTools.js";
import { describeToolCall } from "./progress.js";
import { withRetry } from "../util/retry.js";

/** Read-only GitHub evidence tools, with Gemini-friendly schemas. */
const EVIDENCE_TOOLS: FunctionDeclaration[] = [
  {
    name: "list_recent_commits",
    description:
      "List the most recent commits on the default branch (sha, first line, author, date, url). Pass `path` to see only commits touching one file/directory — ideal once you've located the affected code.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        perPage: { type: Type.NUMBER, description: "How many commits (max 30)." },
        path: { type: Type.STRING, description: "Optional file or directory to scope the history to." },
      },
    },
  },
  {
    name: "get_commit",
    description: "Get one commit's full message and the diff of every file it changed. Use to inspect a suspicious commit.",
    parameters: {
      type: Type.OBJECT,
      properties: { sha: { type: Type.STRING, description: "The commit SHA (full or short)." } },
      required: ["sha"],
    },
  },
  {
    name: "get_file_contents",
    description: "Read the current contents of a file on the default branch.",
    parameters: {
      type: Type.OBJECT,
      properties: { path: { type: Type.STRING, description: "Path to the file, e.g. src/payments.js." } },
      required: ["path"],
    },
  },
  {
    name: "list_recent_pull_requests",
    description:
      "List recently updated pull requests (number, title, state, merged flag, author, mergedAt, url). A recently MERGED PR with a clear author is the strongest signal for what changed and who to ask.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        state: { type: Type.STRING, enum: ["closed", "open", "all"], description: "Which PRs to list. Default closed (most recently merged)." },
        perPage: { type: Type.NUMBER, description: "How many PRs (max 30)." },
      },
    },
  },
  {
    name: "list_open_issues",
    description:
      "List open issues (number, title, author, createdAt, labels, url). Use to check whether the incident is already reported or relates to a known problem area.",
    parameters: {
      type: Type.OBJECT,
      properties: { perPage: { type: Type.NUMBER, description: "How many issues (max 30)." } },
    },
  },
  {
    name: "search_code",
    description:
      "Search the repository's code for a term from the report (a route like /checkout, a symbol, or an error string) to locate the affected file instead of guessing from recent commits.",
    parameters: {
      type: Type.OBJECT,
      properties: { query: { type: Type.STRING, description: "Search term, e.g. checkout or STRIPE_API_KEY." } },
      required: ["query"],
    },
  },
  {
    name: "list_recent_deployments",
    description:
      "List recent deployments (environment, ref, sha, creator, createdAt). Incidents cluster around deploys — check whether something shipped right before the symptom started.",
    parameters: {
      type: Type.OBJECT,
      properties: { perPage: { type: Type.NUMBER, description: "How many deployments (max 20)." } },
    },
  },
  {
    name: "list_recent_workflow_runs",
    description:
      "List recent CI workflow runs (name, conclusion, branch, sha, createdAt, url). A run that flipped from success to failure near the report time is a strong signal.",
    parameters: {
      type: Type.OBJECT,
      properties: { perPage: { type: Type.NUMBER, description: "How many runs (max 30)." } },
    },
  },
  {
    name: RECALL_TOOL_NAME,
    description: RECALL_TOOL_DESCRIPTION,
    parameters: {
      type: Type.OBJECT,
      properties: { query: { type: Type.STRING, description: "The symptom to match, e.g. 'checkout returning 500s'." } },
      required: ["query"],
    },
  },
];

// The finalizer tool definition is shared with the Claude brain — see submitTool.ts.

/** Gemini declarations for the Evidence Hub's two generic tools. */
const HUB_TOOLS: FunctionDeclaration[] = [
  {
    name: HUB_LIST_TOOL_NAME,
    description: HUB_LIST_TOOL_DESCRIPTION,
    parameters: { type: Type.OBJECT, properties: {} },
  },
  {
    name: HUB_QUERY_TOOL_NAME,
    description: HUB_QUERY_TOOL_DESCRIPTION,
    parameters: {
      type: Type.OBJECT,
      properties: {
        source: { type: Type.STRING, description: "The evidence source name (from list_evidence_sources)." },
        tool: { type: Type.STRING, description: "The tool to call on that source." },
        argsJson: { type: Type.STRING, description: "The tool's arguments as a JSON object string, e.g. '{\"query\":\"checkout 500\"}'." },
      },
      required: ["source", "tool"],
    },
  },
];

/**
 * Run one tool through the shared, typed dispatcher and return the JSON envelope
 * the model sees. Shared tools (recall/hub) first, then the GitHub REST tools;
 * an unrecognised name is a typed error, not a silent guess.
 */
async function runEvidenceTool(deps: EvidenceDeps, name: string, args: Record<string, unknown>): Promise<string> {
  const result =
    (await dispatchSharedTool(name, args, deps)) ??
    (await dispatchGithubRestTool(name, args, deps)) ??
    evidenceError(name, `unknown tool: ${name}`);
  return formatEvidenceResult(result);
}

/** Coerce Gemini's args into a valid TriageResult (fill optional fields). */
function normalizeVerdict(args: Record<string, unknown>, priorIncidents: TriageResult["priorIncidents"]): TriageResult {
  return TriageResultSchema.parse({
    ...args,
    confidence: Number(args.confidence),
    suspectedOwner: args.suspectedOwner ?? null,
    evidence: args.evidence ?? [],
    priorIncidents,
    recommendedActions: args.recommendedActions ?? [],
  });
}

/**
 * Gemini-backed triage. Gathers GitHub evidence via the REST tools above, then
 * calls submit_triage with a validated verdict. Free-tier friendly.
 */
export async function runTriageGemini(
  config: AppConfig,
  req: TriageRequest,
  onProgress?: ProgressFn,
): Promise<TriageResult> {
  const repo = req.repo ?? config.GITHUB_DEFAULT_REPO;
  if (!repo) throw new Error(ERR_NO_REPO);

  const ai = new GoogleGenAI({ apiKey: config.GEMINI_API_KEY });
  const memory = new IncidentMemory(config);
  const collectedHits: RecallHit[] = [];
  // The Evidence Hub's generic tools only register when sources are configured
  // — no tool noise for a GitHub-only setup.
  const hub = new EvidenceHub(parseEvidenceServers(config.EVIDENCE_MCP_SERVERS));
  const deps: EvidenceDeps = { config, repo, memory, hub, collectedHits };
  const functionDeclarations = [...EVIDENCE_TOOLS, ...(hub.enabled ? HUB_TOOLS : []), SUBMIT_TOOL_GEMINI];
  const contents: Content[] = [{ role: "user", parts: [{ text: buildTriageUserMessage(req, repo) }] }];

  try {
  for (let step = 0; step < config.TRIAGE_MAX_STEPS; step++) {
    const forceSubmit = step === config.TRIAGE_MAX_STEPS - 1;
    // Retried on transient failures (per-minute rate limits, network blips) —
    // a spent daily quota exhausts retries fast and surfaces the real error.
    const result = await withRetry(() =>
      ai.models.generateContent({
        model: config.GEMINI_MODEL,
        contents,
      config: {
        systemInstruction: TRIAGE_SYSTEM_PROMPT,
        tools: [{ functionDeclarations }],
        toolConfig: {
          functionCallingConfig: forceSubmit
            ? { mode: FunctionCallingConfigMode.ANY, allowedFunctionNames: [SUBMIT_TOOL_NAME] }
            : { mode: FunctionCallingConfigMode.AUTO },
        },
        },
      }),
    );

    const calls = result.functionCalls ?? [];
    const modelContent = result.candidates?.[0]?.content;

    if (calls.length === 0) {
      contents.push({ role: "model", parts: [{ text: result.text ?? "" }] });
      contents.push({ role: "user", parts: [{ text: "Call submit_triage now with your final structured verdict." }] });
      continue;
    }

    contents.push(modelContent ?? { role: "model", parts: calls.map((c) => ({ functionCall: c })) });

    const submit = calls.find((c) => c.name === SUBMIT_TOOL_NAME);
    if (submit) {
      return normalizeVerdict((submit.args as Record<string, unknown>) ?? {}, toPriorIncidents(collectedHits));
    }

    // One status update per round — N racing chat.updates on the same message
    // would burn Slack rate limit and land in arbitrary order.
    await onProgress?.([...new Set(calls.map((c) => describeToolCall(c.name)))].join(" · "));

    // The model often asks for several lookups at once — run them concurrently
    // (Promise.all preserves order, so responses stay aligned with the calls).
    const responseParts: Part[] = await Promise.all(
      calls.map(async (call) => {
        const text = await runEvidenceTool(deps, call.name ?? "", (call.args as Record<string, unknown>) ?? {});
        return { functionResponse: { name: call.name ?? "", response: { result: text } } };
      }),
    );
    contents.push({ role: "user", parts: responseParts });
  }

  throw new Error(ERR_NO_CONVERGE);
  } finally {
    await hub.close();
  }
}
