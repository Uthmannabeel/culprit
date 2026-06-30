import { z } from "zod";

/**
 * The structured verdict Triage produces for an incident. This is what the
 * Slack UX renders and what the MCP server returns to external agents — one
 * shape, two surfaces.
 */
export const TriageResultSchema = z.object({
  /** One-line summary of what is most likely wrong. */
  summary: z.string(),
  /** The leading root-cause hypothesis, in plain language. */
  rootCauseHypothesis: z.string(),
  /** 0-100 — how confident the analysis is in that hypothesis. */
  confidence: z.number().min(0).max(100),
  /** Operational severity, judged from the report + evidence. */
  severity: z.enum(["sev1", "sev2", "sev3", "unknown"]),
  /** Who most likely owns the affected area (GitHub handle or team), best-effort. */
  suspectedOwner: z.string().nullable(),
  /** Evidence the conclusion rests on — each item links back to a real source. */
  evidence: z
    .array(
      z.object({
        kind: z.enum(["commit", "pull_request", "issue", "file", "past_incident", "other"]),
        title: z.string(),
        url: z.string().nullable(),
        why: z.string(),
      }),
    )
    .default([]),
  /**
   * Similar incidents the org has resolved before — Culprit's institutional
   * memory. Attached from recall so the "we've seen this before" panel is
   * reliable, not dependent on the model remembering to cite it.
   */
  priorIncidents: z
    .array(
      z.object({
        id: z.string(),
        symptom: z.string(),
        resolution: z.string(),
        resolvedBy: z.string().nullable(),
        similarity: z.number(),
        url: z.string().nullable(),
      }),
    )
    .default([]),
  /** Concrete next steps a responder can take right now. */
  recommendedActions: z.array(z.string()).default([]),
  /** A ready-to-file GitHub issue drafted from the analysis. */
  draftIssue: z.object({
    title: z.string(),
    body: z.string(),
    labels: z.array(z.string()).default([]),
  }),
});

export type TriageResult = z.infer<typeof TriageResultSchema>;

/** Input to a triage run. */
export interface TriageRequest {
  /** The raw incident report text from the user. */
  report: string;
  /** owner/repo to investigate. Falls back to GITHUB_DEFAULT_REPO. */
  repo?: string;
  /** Who reported it (Slack display name), for context only. */
  reportedBy?: string;
}
