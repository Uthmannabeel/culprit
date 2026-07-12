import type Anthropic from "@anthropic-ai/sdk";
import { Type } from "@google/genai";
import type { FunctionDeclaration } from "@google/genai";

/**
 * The submit_triage finalizer, defined ONCE for both brains. The field list and
 * descriptions live here; the two SDK schemas below are built from them side by
 * side so they cannot drift apart again (a previous drift made Gemini omit
 * evidence urls that the Zod schema then rejected — a whole triage lost after
 * it had already succeeded). If you add a verdict field: add it to BOTH
 * definitions in this file AND to TriageResultSchema in types.ts.
 */

export const SUBMIT_TOOL_NAME = "submit_triage";

const DESC = {
  tool: "Call this exactly once, when you have gathered enough evidence, to deliver your final triage verdict.",
  summary: "One-line summary of what is most likely wrong.",
  rootCauseHypothesis: "Leading root-cause hypothesis, in plain language.",
  confidence: "0-100 confidence in the hypothesis.",
  suspectedOwner: "GitHub handle/team that owns the area, or null.",
  evidenceWhy: "Why this evidence supports the hypothesis.",
  issueBody: "Markdown body for a fileable GitHub issue.",
} as const;

const SEVERITIES = ["sev1", "sev2", "sev3", "unknown"];
const EVIDENCE_KINDS = ["commit", "pull_request", "issue", "file", "past_incident", "other"];

/** Anthropic (Claude) tool definition. */
export const SUBMIT_TOOL_ANTHROPIC: Anthropic.Tool = {
  name: SUBMIT_TOOL_NAME,
  description: DESC.tool,
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      summary: { type: "string", description: DESC.summary },
      rootCauseHypothesis: { type: "string", description: DESC.rootCauseHypothesis },
      confidence: { type: "number", description: DESC.confidence },
      severity: { type: "string", enum: SEVERITIES },
      suspectedOwner: { type: ["string", "null"], description: DESC.suspectedOwner },
      evidence: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            kind: { type: "string", enum: EVIDENCE_KINDS },
            title: { type: "string" },
            url: { type: ["string", "null"] },
            why: { type: "string", description: DESC.evidenceWhy },
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
          body: { type: "string", description: DESC.issueBody },
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

/** Gemini function declaration for the same tool. */
export const SUBMIT_TOOL_GEMINI: FunctionDeclaration = {
  name: SUBMIT_TOOL_NAME,
  description: DESC.tool,
  parameters: {
    type: Type.OBJECT,
    properties: {
      summary: { type: Type.STRING, description: DESC.summary },
      rootCauseHypothesis: { type: Type.STRING, description: DESC.rootCauseHypothesis },
      confidence: { type: Type.NUMBER, description: DESC.confidence },
      severity: { type: Type.STRING, enum: SEVERITIES },
      suspectedOwner: { type: Type.STRING, nullable: true, description: DESC.suspectedOwner },
      evidence: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            kind: { type: Type.STRING, enum: EVIDENCE_KINDS },
            title: { type: Type.STRING },
            url: { type: Type.STRING, nullable: true },
            why: { type: Type.STRING, description: DESC.evidenceWhy },
          },
          required: ["kind", "title", "why"],
        },
      },
      recommendedActions: { type: Type.ARRAY, items: { type: Type.STRING } },
      draftIssue: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          body: { type: Type.STRING, description: DESC.issueBody },
          labels: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: ["title", "body", "labels"],
      },
    },
    required: ["summary", "rootCauseHypothesis", "confidence", "severity", "draftIssue"],
  },
};
