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
        // Gemini's tool schema declares url nullable-but-optional and the model
        // routinely omits non-required keys — a missing url must not reject an
        // otherwise-complete verdict after the investigation already succeeded.
        url: z
          .string()
          .nullish()
          .transform((v) => v ?? null),
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
        /** Which repo the past incident belonged to — cross-repo matches are labeled. */
        repo: z.string().nullable().default(null),
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
  /** Prior discussion from the thread the report was made in, if any. */
  threadContext?: string;
}

/** Optional progress callback so the Slack handler can stream status updates. */
export type ProgressFn = (note: string) => void | Promise<void>;

/** Shared error messages — both brains throw the same words for the same failure. */
export const ERR_NO_REPO = "No repository specified and GITHUB_DEFAULT_REPO is not set.";
export const ERR_NO_CONVERGE = "Triage did not converge on a verdict within the step budget.";
