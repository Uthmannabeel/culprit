import type { KnownBlock } from "@slack/types";
import type { TriageResult } from "../triage/types.js";
import { ACTION_MARK_RESOLVED, type ResolveContext } from "./resolve.js";

/** Action IDs for interactive components. */
export const ACTION_CREATE_ISSUE = "triage_create_issue";

const SEVERITY_LABEL: Record<TriageResult["severity"], string> = {
  sev1: "🔴 SEV1 — critical",
  sev2: "🟠 SEV2 — major",
  sev3: "🟡 SEV3 — minor",
  unknown: "⚪ severity unclear",
};

function confidenceBar(confidence: number): string {
  const filled = Math.round(Math.max(0, Math.min(100, confidence)) / 10);
  return `${"█".repeat(filled)}${"░".repeat(10 - filled)} ${Math.round(confidence)}%`;
}

/**
 * Render a triage verdict as Slack Block Kit. The draftIssue is stashed in the
 * button value so the action handler can file it without re-running analysis.
 */
export function renderTriageBlocks(
  result: TriageResult,
  repo: string,
  report?: string,
  canvas?: { id: string | null; url: string | null },
): KnownBlock[] {
  const blocks: KnownBlock[] = [
    {
      type: "header",
      text: { type: "plain_text", text: "🔍 Culprit — triage verdict", emoji: true },
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: `*${escape(result.summary)}*` },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Severity*\n${SEVERITY_LABEL[result.severity]}` },
        { type: "mrkdwn", text: `*Confidence*\n\`${confidenceBar(result.confidence)}\`` },
        { type: "mrkdwn", text: `*Repository*\n\`${escape(repo)}\`` },
        {
          type: "mrkdwn",
          text: `*Suspected owner*\n${result.suspectedOwner ? escape(result.suspectedOwner) : "_not determined_"}`,
        },
      ],
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: `*Likely cause (hypothesis)*\n${escape(result.rootCauseHypothesis)}` },
    },
  ];

  if (result.priorIncidents.length > 0) {
    blocks.push({ type: "divider" });
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "🧠 *We've seen this before*" },
    });
    for (const p of result.priorIncidents.slice(0, 3)) {
      const who = p.resolvedBy ? ` — fixed by *${escape(p.resolvedBy)}*` : "";
      const link = p.url ? ` <${p.url}|details>` : "";
      const match = `${Math.round(p.similarity * 100)}% match`;
      const fix = p.resolution ? `\n   _Last time:_ ${escape(p.resolution)}` : "";
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: `• \`${match}\` ${escape(p.symptom)}${who}${link}${fix}` },
      });
    }
  }

  if (result.evidence.length > 0) {
    blocks.push({ type: "divider" });
    blocks.push({ type: "section", text: { type: "mrkdwn", text: "*Evidence*" } });
    for (const e of result.evidence.slice(0, 8)) {
      const link = e.url ? `<${e.url}|${escape(e.title)}>` : escape(e.title);
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: `• \`${e.kind}\` ${link}\n   ${escape(e.why)}` },
      });
    }
  }

  if (result.recommendedActions.length > 0) {
    blocks.push({ type: "divider" });
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Recommended next steps*\n${result.recommendedActions.map((a) => `• ${escape(a)}`).join("\n")}`,
      },
    });
  }

  blocks.push({ type: "divider" });
  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text: `*Draft issue:* ${escape(result.draftIssue.title)}\n_Labels: ${
        result.draftIssue.labels.length ? result.draftIssue.labels.map((l) => `\`${escape(l)}\``).join(" ") : "none"
      }_`,
    },
  });
  if (canvas?.url) {
    blocks.push({ type: "divider" });
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `📄 <${canvas.url}|Live incident canvas> — updates as this resolves` },
    });
  }

  const resolveCtx: ResolveContext = {
    symptom: (report ?? result.summary).slice(0, 300),
    hypothesis: result.rootCauseHypothesis.slice(0, 600),
    repo,
    suspectedOwner: result.suspectedOwner,
    link: result.evidence.find((e) => e.url)?.url ?? result.priorIncidents[0]?.url ?? null,
    channel: null,
    threadTs: null,
    canvasId: canvas?.id ?? null,
  };
  blocks.push({
    type: "actions",
    elements: [
      {
        type: "button",
        style: "primary",
        text: { type: "plain_text", text: "📝 Create GitHub issue", emoji: true },
        action_id: ACTION_CREATE_ISSUE,
        value: JSON.stringify({ repo, issue: result.draftIssue }),
      },
      {
        type: "button",
        text: { type: "plain_text", text: "✅ Mark resolved", emoji: true },
        action_id: ACTION_MARK_RESOLVED,
        value: JSON.stringify(resolveCtx),
      },
    ],
  });
  blocks.push({
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: "Triage proposes a hypothesis from real GitHub evidence — confirm before acting.",
      },
    ],
  });

  return blocks;
}

/** Escape Slack mrkdwn control characters in untrusted text. */
function escape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
