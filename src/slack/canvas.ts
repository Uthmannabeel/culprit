import type { WebClient } from "@slack/web-api";
import type { IncidentRecord } from "../memory/types.js";
import type { TriageResult } from "../triage/types.js";

/**
 * The living incident canvas. Culprit opens a Slack Canvas when it posts a
 * verdict and appends the resolution when the incident is closed — a durable,
 * shareable record that lives natively in Slack (not a pasted card that scrolls
 * away). All Slack calls are best-effort: if the workspace/token can't create
 * canvases, triage still works — the canvas is a bonus, never a blocker.
 */

const SEVERITY: Record<TriageResult["severity"], string> = {
  sev1: "🔴 SEV1 — critical",
  sev2: "🟠 SEV2 — major",
  sev3: "🟡 SEV3 — minor",
  unknown: "⚪ unclear",
};

/** Markdown for a fresh incident canvas, built from the verdict. Pure. */
export function buildIncidentCanvasMarkdown(
  result: TriageResult,
  repo: string,
  report: string,
  reportedBy?: string,
): string {
  const lines: string[] = [];
  lines.push(`# 🔍 Incident: ${result.summary}`);
  lines.push("");
  lines.push(`**Status:** 🟠 Investigating`);
  lines.push(`**Severity:** ${SEVERITY[result.severity]}`);
  lines.push(`**Repository:** ${repo}`);
  lines.push(`**Reported:** ${report}${reportedBy ? ` (by ${reportedBy})` : ""}`);
  lines.push("");
  lines.push(`## Likely cause (hypothesis · ${Math.round(result.confidence)}% confidence)`);
  lines.push(result.rootCauseHypothesis);

  if (result.priorIncidents.length > 0) {
    lines.push("");
    lines.push("## 🧠 We've seen this before");
    for (const p of result.priorIncidents.slice(0, 3)) {
      const who = p.resolvedBy ? ` — fixed by ${p.resolvedBy}` : "";
      const pct = `${Math.round(p.similarity * 100)}%`;
      lines.push(`- **${pct} match** ${p.symptom}${who}${p.resolution ? `\n  _Last time:_ ${p.resolution}` : ""}`);
    }
  }

  if (result.evidence.length > 0) {
    lines.push("");
    lines.push("## Evidence");
    for (const e of result.evidence.slice(0, 8)) {
      const title = e.url ? `[${e.title}](${e.url})` : e.title;
      lines.push(`- \`${e.kind}\` ${title} — ${e.why}`);
    }
  }

  lines.push("");
  lines.push(`## Suspected owner`);
  lines.push(result.suspectedOwner ? `@${result.suspectedOwner}` : "_not determined_");

  if (result.recommendedActions.length > 0) {
    lines.push("");
    lines.push("## Recommended next steps");
    for (const a of result.recommendedActions) lines.push(`- [ ] ${a}`);
  }

  lines.push("");
  lines.push("---");
  lines.push("_Culprit — a hypothesis backed by evidence. Confirm before acting._");
  return lines.join("\n");
}

/** Markdown appended to the canvas when the incident is resolved. Pure. */
export function buildResolutionCanvasMarkdown(record: IncidentRecord): string {
  const verdict =
    record.hypothesisWasCorrect === true
      ? "✅ hypothesis was correct"
      : record.hypothesisWasCorrect === false
        ? "❌ hypothesis was wrong"
        : "➖ hypothesis was partly right";
  const lines: string[] = [
    "",
    "## ✅ Resolved",
    `**What fixed it:** ${record.resolution || "(not recorded)"}`,
    `**Fixed by:** ${record.resolvedBy ?? "unknown"}`,
    `**Outcome:** ${verdict}`,
    "_Recorded to Culprit's memory — it will recall this next time._",
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
