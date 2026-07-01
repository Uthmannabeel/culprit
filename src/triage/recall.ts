import type { RecallHit } from "../memory/types.js";
import type { TriageResult } from "./types.js";

/**
 * Shared incident-memory recall glue used by BOTH brains (Claude + Gemini), so
 * the "we've seen this before" feature behaves identically regardless of which
 * model drives triage. Pure and deterministic → easy to unit-test.
 */

export const RECALL_TOOL_NAME = "recall_incident_memory";
export const RECALL_TOOL_DESCRIPTION =
  "Search the org's past resolved incidents for ones similar to this report (returns symptom, root cause, what actually fixed it, who fixed it, and a similarity score). ALWAYS call this first — if this incident resembles a past one, that is your strongest lead.";

/** The JSON payload the model sees for a recall call. */
export function formatRecallResult(hits: RecallHit[]): string {
  return JSON.stringify(
    hits.map((h) => ({
      id: h.record.id,
      symptom: h.record.symptom,
      rootCause: h.record.rootCause,
      resolution: h.record.resolution,
      resolvedBy: h.record.resolvedBy,
      similarity: Number(h.score.toFixed(3)),
      matchedBy: h.method,
      links: h.record.links,
    })),
  );
}

/**
 * Build the reliable priorIncidents panel from whatever recall surfaced —
 * deduped by id (keeping the best score) and sorted strongest-first. Attached to
 * the verdict independently of the model, so the panel never depends on the
 * model remembering to cite it.
 */
export function toPriorIncidents(hits: RecallHit[]): TriageResult["priorIncidents"] {
  const byId = new Map<string, RecallHit>();
  for (const h of hits) {
    const existing = byId.get(h.record.id);
    if (!existing || h.score > existing.score) byId.set(h.record.id, h);
  }
  return [...byId.values()]
    .sort((a, b) => b.score - a.score)
    .map((h) => ({
      id: h.record.id,
      symptom: h.record.symptom,
      resolution: h.record.resolution,
      resolvedBy: h.record.resolvedBy,
      similarity: Number(h.score.toFixed(3)),
      url: h.record.links[0] ?? null,
    }));
}
