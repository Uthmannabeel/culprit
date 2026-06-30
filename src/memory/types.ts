import { z } from "zod";

/**
 * One past incident the org has already worked through — the unit of Culprit's
 * institutional memory. Resolved incidents are the most valuable: they carry
 * the *actual* fix and who applied it, not just a hypothesis.
 */
export const IncidentRecordSchema = z.object({
  id: z.string(),
  /** The reported symptom, in the reporter's words. */
  symptom: z.string(),
  /** The confirmed root cause (filled in once known). */
  rootCause: z.string().default(""),
  /** What actually fixed it. */
  resolution: z.string().default(""),
  /** Who resolved it (GitHub/Slack handle), best-effort. */
  resolvedBy: z.string().nullable().default(null),
  /** Links to the PR/commit/issue/thread that closed it. */
  links: z.array(z.string()).default([]),
  /** owner/repo the incident belonged to, if known. */
  repo: z.string().nullable().default(null),
  /** ISO timestamp the incident was recorded. */
  createdAt: z.string().default(""),
  /** Whether Culprit's original hypothesis turned out correct (learning signal). */
  hypothesisWasCorrect: z.boolean().nullable().default(null),
  /** Cached embedding of the symptom + root cause, if computed. */
  embedding: z.array(z.number()).nullable().default(null),
});

export type IncidentRecord = z.infer<typeof IncidentRecordSchema>;

/** A recalled incident plus how closely it matches the current report. */
export interface RecallHit {
  record: IncidentRecord;
  /** 0-1 similarity score. */
  score: number;
  /** Which method produced the score, for honesty in the UI/logs. */
  method: "embedding" | "lexical";
}

/** The text we embed/compare for a record — symptom carries the most signal. */
export function recordText(record: Pick<IncidentRecord, "symptom" | "rootCause">): string {
  return [record.symptom, record.rootCause].filter(Boolean).join(" — ");
}
