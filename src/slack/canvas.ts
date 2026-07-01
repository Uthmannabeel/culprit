import type { WebClient } from "@slack/web-api";
import type { IncidentRecord } from "../memory/types.js";
import type { TriageResult } from "../triage/types.js";
import { SEVERITY_LABEL, confidenceLabel, mdSafe, safeHttpUrl, similarityLabel } from "./format.js";

export { mdSafe, safeHttpUrl } from "./format.js";

/**
 * The living incident canvas. Culprit opens a Slack Canvas when it posts a
 * verdict and appends the resolution when the incident is closed — a durable,
 * shareable record that lives natively in Slack (not a pasted card that scrolls
 * away). All Slack calls are best-effort: if the workspace/token can't create
 * canvases, triage still works — the canvas is a bonus, never a blocker.
 */

/**
 * Markdown for a fresh incident canvas, built from the verdict. Pure. Mirrors
 * the card's design system: severity circle is the only emoji, categorical
 * confidence/similarity, numbered linked evidence, provenance at the bottom.
 */
export function buildIncidentCanvasMarkdown(
  result: TriageResult,
  repo: string,
  report: string,
  reportedBy?: string,
): string {
  const lines: string[] = [];
  lines.push(`# Incident: ${mdSafe(result.summary)}`);
  lines.push("");
  lines.push(`**Status:** Investigating`);
  lines.push(`**Severity:** ${SEVERITY_LABEL[result.severity]}`);
  lines.push(`**Repository:** ${mdSafe(repo)}`);
  lines.push(`**Reported:** ${mdSafe(report)}${reportedBy ? ` (by ${mdSafe(reportedBy)})` : ""}`);
  lines.push("");
  lines.push(`## Likely root cause`);
  lines.push(mdSafe(result.rootCauseHypothesis));
  lines.push("");
  lines.push(`**Confidence:** ${confidenceLabel(result.confidence)}`);

  if (result.priorIncidents.length > 0) {
    lines.push("");
    lines.push("## Prior incidents");
    for (const p of result.priorIncidents.slice(0, 3)) {
      const link = safeHttpUrl(p.url);
      const ref = link ? ` ([details](${link}))` : "";
      const who = p.resolvedBy ? ` Resolved by ${mdSafe(p.resolvedBy)}.` : "";
      const fix = p.resolution ? ` Fix at the time: ${mdSafe(p.resolution)}` : "";
      lines.push(`- **${similarityLabel(p.similarity)}** — ${mdSafe(p.symptom)}${ref}.${who}${fix}`);
    }
  }

  if (result.evidence.length > 0) {
    lines.push("");
    lines.push("## Evidence");
    result.evidence.slice(0, 8).forEach((e, i) => {
      const url = safeHttpUrl(e.url);
      const title = url ? `[${mdSafe(e.title)}](${url})` : mdSafe(e.title);
      lines.push(`${i + 1}. ${title} — ${mdSafe(e.why)}`);
    });
  }

  lines.push("");
  lines.push(`## Suggested owner`);
  lines.push(result.suspectedOwner ? `${mdSafe(result.suspectedOwner)}` : "_Not determined._");

  if (result.recommendedActions.length > 0) {
    lines.push("");
    lines.push("## Suggested next steps");
    for (const a of result.recommendedActions.slice(0, 4)) lines.push(`- [ ] ${mdSafe(a)}`);
  }

  lines.push("");
  lines.push("---");
  lines.push("_Culprit · AI-generated hypothesis, not a verdict — every claim links to its source._");
  return lines.join("\n");
}

/** Markdown appended to the canvas when the incident is resolved. Pure. */
export function buildResolutionCanvasMarkdown(record: IncidentRecord): string {
  const outcome =
    record.hypothesisWasCorrect === true
      ? "correct"
      : record.hypothesisWasCorrect === false
        ? "incorrect"
        : "partially correct";
  const lines: string[] = [
    "",
    "## Resolution",
    `**What fixed it:** ${record.resolution ? mdSafe(record.resolution) : "(not recorded)"}`,
    `**Resolved by:** ${record.resolvedBy ? mdSafe(record.resolvedBy) : "unknown"}`,
    `**Hypothesis was:** ${outcome}`,
    "",
    "_Recorded to Culprit's memory — a similar incident will recall this resolution._",
  ];
  return lines.join("\n");
}

export interface CreatedCanvas {
  canvasId: string;
  url: string | null;
}

/** Create an incident canvas and grant the channel access. Best-effort → null. */
export async function createIncidentCanvas(
  client: WebClient,
  args: { title: string; markdown: string; channel: string | null },
): Promise<CreatedCanvas | null> {
  try {
    const res = await client.canvases.create({
      title: args.title,
      document_content: { type: "markdown", markdown: args.markdown },
    });
    const canvasId = res.canvas_id;
    if (!canvasId) return null;

    if (args.channel) {
      await client.canvases.access
        .set({ canvas_id: canvasId, channel_ids: [args.channel], access_level: "read" })
        .catch(() => undefined);
    }
    // Canvases are file-backed; try to surface a clickable permalink.
    const url = await client.files
      .info({ file: canvasId })
      .then((f) => (f.file as { permalink?: string } | undefined)?.permalink ?? null)
      .catch(() => null);

    return { canvasId, url };
  } catch {
    return null;
  }
}

/** Append the resolution to an existing canvas. Best-effort → false. */
export async function appendResolution(client: WebClient, canvasId: string, markdown: string): Promise<boolean> {
  try {
    await client.canvases.edit({
      canvas_id: canvasId,
      changes: [{ operation: "insert_at_end", document_content: { type: "markdown", markdown } }],
    });
    return true;
  } catch {
    return false;
  }
}
