import { GoogleGenAI, Type, FunctionCallingConfigMode } from "@google/genai";
import type { Content, FunctionDeclaration, Part } from "@google/genai";
import type { AppConfig } from "../config.js";
import { TRIAGE_SYSTEM_PROMPT, buildTriageUserMessage } from "./prompt.js";
import { TriageResultSchema, type TriageRequest, type TriageResult } from "./types.js";
import { listRecentCommits, getCommit, getFileContents } from "../github/evidence.js";
import type { ProgressFn } from "./brainClaude.js";

/** Read-only GitHub evidence tools, with Gemini-friendly schemas. */
const EVIDENCE_TOOLS: FunctionDeclaration[] = [
  {
    name: "list_recent_commits",
    description: "List the most recent commits on the default branch (sha, first line, author, date, url). Start here.",
    parameters: {
      type: Type.OBJECT,
      properties: { perPage: { type: Type.NUMBER, description: "How many commits (max 30)." } },
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
            kind: { type: Type.STRING, enum: ["commit", "pull_request", "issue", "file", "other"] },
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
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  try {
    if (name === "list_recent_commits") {
      const commits = await listRecentCommits(config, repo, Number(args.perPage) || 12);
      return JSON.stringify(commits);
    }
    if (name === "get_commit") {
      return JSON.stringify(await getCommit(config, repo, String(args.sha)));
    }
    if (name === "get_file_contents") {
      return await getFileContents(config, repo, String(args.path));
    }
    return `Unknown tool: ${name}`;
  } catch (err) {
    return `Tool "${name}" failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}

/** Coerce Gemini's args into a valid TriageResult (fill optional fields). */
function normalizeVerdict(args: Record<string, unknown>): TriageResult {
  return TriageResultSchema.parse({
    ...args,
    confidence: Number(args.confidence),
    suspectedOwner: args.suspectedOwner ?? null,
    evidence: args.evidence ?? [],
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
  const functionDeclarations = [...EVIDENCE_TOOLS, SUBMIT_TOOL];
  const contents: Content[] = [{ role: "user", parts: [{ text: buildTriageUserMessage(req, repo) }] }];

  for (let step = 0; step < config.TRIAGE_MAX_STEPS; step++) {
    const forceSubmit = step === config.TRIAGE_MAX_STEPS - 1;
    const result = await ai.models.generateContent({
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
    });

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
      return normalizeVerdict((submit.args as Record<string, unknown>) ?? {});
    }

    const responseParts: Part[] = [];
    for (const call of calls) {
      await onProgress?.(`Checking GitHub: ${call.name}`);
      const text = await runEvidenceTool(config, repo, call.name ?? "", (call.args as Record<string, unknown>) ?? {});
      responseParts.push({ functionResponse: { name: call.name ?? "", response: { result: text } } });
    }
    contents.push({ role: "user", parts: responseParts });
  }

  throw new Error("Triage did not converge on a verdict within the step budget.");
}
