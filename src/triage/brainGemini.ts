import { GoogleGenAI, Type, FunctionCallingConfigMode } from "@google/genai";
import type { Content, FunctionDeclaration, Part } from "@google/genai";
import type { AppConfig } from "../config.js";
import { TRIAGE_SYSTEM_PROMPT, buildTriageUserMessage } from "./prompt.js";
import { TriageResultSchema, type TriageRequest, type TriageResult } from "./types.js";
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
import { IncidentMemory } from "../memory/store.js";
import type { RecallHit } from "../memory/types.js";
import type { ProgressFn } from "./types.js";
import { RECALL_TOOL_NAME, RECALL_TOOL_DESCRIPTION, formatRecallResult, toPriorIncidents } from "./recall.js";
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

/** The structured finalizer — Gemini calls this once with its verdict. */
const SUBMIT_TOOL: FunctionDeclaration = {
  name: "submit_triage",
  description: "Call exactly once, when you have enough evidence, to deliver your final triage verdict.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      summary: { type: Type.STRING },
      rootCauseHypothesis: { type: Type.STRING },
      confidence: { type: Type.NUMBER, description: "0-100 confidence in the hypothesis." },
      severity: { type: Type.STRING, enum: ["sev1", "sev2", "sev3", "unknown"] },
      suspectedOwner: { type: Type.STRING, nullable: true, description: "GitHub handle/team, or null." },
      evidence: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            kind: { type: Type.STRING, enum: ["commit", "pull_request", "issue", "file", "past_incident", "other"] },
            title: { type: Type.STRING },
            url: { type: Type.STRING, nullable: true },
            why: { type: Type.STRING },
          },
          required: ["kind", "title", "why"],
        },
      },
      recommendedActions: { type: Type.ARRAY, items: { type: Type.STRING } },
      draftIssue: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          body: { type: Type.STRING },
          labels: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: ["title", "body", "labels"],
      },
    },
    required: ["summary", "rootCauseHypothesis", "confidence", "severity", "draftIssue"],
  },
};

/** Run one evidence tool and return a text result for the model. */
async function runEvidenceTool(
  config: AppConfig,
  repo: string,
  memory: IncidentMemory,
  collectedHits: RecallHit[],
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  try {
    if (name === "list_recent_commits") {
      const path = typeof args.path === "string" && args.path.length > 0 ? args.path : undefined;
      const commits = await listRecentCommits(config, repo, Number(args.perPage) || 12, path);
      return JSON.stringify(commits);
    }
    if (name === "list_recent_deployments") {
      return JSON.stringify(await listRecentDeployments(config, repo, Number(args.perPage) || 5));
    }
    if (name === "list_recent_workflow_runs") {
      return JSON.stringify(await listRecentWorkflowRuns(config, repo, Number(args.perPage) || 10));
    }
    if (name === "get_commit") {
      return JSON.stringify(await getCommit(config, repo, String(args.sha)));
    }
    if (name === "get_file_contents") {
      return await getFileContents(config, repo, String(args.path));
    }
    if (name === "list_recent_pull_requests") {
      const state = args.state === "open" || args.state === "all" ? args.state : "closed";
      const prs = await listRecentPullRequests(config, repo, state, Number(args.perPage) || 10);
      return JSON.stringify(prs);
    }
    if (name === "list_open_issues") {
      return JSON.stringify(await listOpenIssues(config, repo, Number(args.perPage) || 10));
    }
    if (name === "search_code") {
      return JSON.stringify(await searchCode(config, repo, String(args.query)));
    }
    if (name === RECALL_TOOL_NAME) {
      const hits = await memory.recall(String(args.query ?? ""), undefined, repo);
      collectedHits.push(...hits);
      return formatRecallResult(hits);
    }
    return `Unknown tool: ${name}`;
  } catch (err) {
    return `Tool "${name}" failed: ${err instanceof Error ? err.message : String(err)}`;
  }
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
  if (!repo) throw new Error("No repository specified and GITHUB_DEFAULT_REPO is not set.");

  const ai = new GoogleGenAI({ apiKey: config.GEMINI_API_KEY });
  const memory = new IncidentMemory(config);
  const collectedHits: RecallHit[] = [];
  const functionDeclarations = [...EVIDENCE_TOOLS, SUBMIT_TOOL];
  const contents: Content[] = [{ role: "user", parts: [{ text: buildTriageUserMessage(req, repo) }] }];

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
            ? { mode: FunctionCallingConfigMode.ANY, allowedFunctionNames: ["submit_triage"] }
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

    const submit = calls.find((c) => c.name === "submit_triage");
    if (submit) {
      return normalizeVerdict((submit.args as Record<string, unknown>) ?? {}, toPriorIncidents(collectedHits));
    }

    // The model often asks for several lookups at once — run them concurrently
    // (Promise.all preserves order, so responses stay aligned with the calls).
    const responseParts: Part[] = await Promise.all(
      calls.map(async (call) => {
        await onProgress?.(describeToolCall(call.name));
        const text = await runEvidenceTool(
          config,
          repo,
          memory,
          collectedHits,
          call.name ?? "",
          (call.args as Record<string, unknown>) ?? {},
        );
        return { functionResponse: { name: call.name ?? "", response: { result: text } } };
      }),
    );
    contents.push({ role: "user", parts: responseParts });
  }

  throw new Error("Triage did not converge on a verdict within the step budget.");
}
