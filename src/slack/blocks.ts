import type { KnownBlock } from "@slack/types";
import type { TriageResult } from "../triage/types.js";
import { ACTION_MARK_RESOLVED, type ResolveContext } from "./resolve.js";
import {
  SEVERITY_LABEL,
  clampSectionText,
  confidenceLabel,
  escapeMrkdwn as escape,
  linkLabel,
  safeHttpUrl,
  similarityLabel,
} from "./format.js";
import { encodeIssuePayload } from "./draftStore.js";

export { confidenceLabel, similarityLabel } from "./format.js";

/** Action IDs for interactive components. */
export const ACTION_CREATE_ISSUE = "triage_create_issue";

/**
 * Verdict-card design system — benchmarked against incident.io, Rootly,
 * PagerDuty, Datadog Bits AI, and Slack's own Block Kit guidance:
 * - One colored circle for severity (the industry-standard signal) — no other
 *   decorative emoji anywhere in the card.
 * - Confidence and similarity as categorical WORDS, never percentage bars.
 * - Labels bold, values plain. Evidence numbered and linked (verifiable <30s).
 * - Max two buttons, plain verb labels. Provenance lives in the context footer.
 */

/**
 * Render a triage verdict as Slack Block Kit. Fixed anatomy every time —
 * title, facts, cause, prior incidents, evidence, next steps, actions,
 * provenance — because consistency of structure is itself a trust signal.
 */
export function renderTriageBlocks(
  result: TriageResult,
  repo: string,
  report?: string,
  canvas?: { id: string | null; url: string | null },
): KnownBlock[] {
  const blocks: KnownBlock[] = [];

  // The title is the incident, not the bot. Plain text — no injection surface.
  blocks.push({
    type: "header",
    text: { type: "plain_text", text: result.summary.slice(0, 150), emoji: true },
  });

  blocks.push({
    type: "section",
    fields: [
      { type: "mrkdwn", text: `*Severity:*\n${SEVERITY_LABEL[result.severity]}` },
      { type: "mrkdwn", text: `*Confidence:*\n${confidenceLabel(result.confidence)}` },
      { type: "mrkdwn", text: `*Repository:*\n\`${escape(repo)}\`` },
      {
        type: "mrkdwn",
        text: `*Suggested owner:*\n${result.suspectedOwner ? escape(result.suspectedOwner.slice(0, 80)) : "not determined"}`,
      },
    ],
  });

  blocks.push({
    type: "section",
    text: { type: "mrkdwn", text: clampSectionText(`*Likely root cause*\n${escape(result.rootCauseHypothesis)}`) },
  });

  if (result.priorIncidents.length > 0) {
    const lines = result.priorIncidents.slice(0, 2).map((p) => {
      const link = safeHttpUrl(p.url);
      const ref = link ? ` (<${link}|details>)` : "";
      const who = p.resolvedBy ? ` Resolved by ${escape(p.resolvedBy.slice(0, 80))}.` : "";
      const fix = p.resolution ? ` Fix at the time: ${escape(p.resolution.slice(0, 300))}` : "";
      return `*${similarityLabel(p.similarity)}* — ${escape(p.symptom.slice(0, 200))}${ref}.${who}${fix}`;
    });
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: clampSectionText(`*Prior incident match*\n${lines.join("\n")}`) },
    });
  }

  if (result.evidence.length > 0) {
    const lines = result.evidence.slice(0, 6).map((e, i) => {
      const url = safeHttpUrl(e.url);
      const title = url ? `<${url}|${linkLabel(e.title.slice(0, 120))}>` : escape(e.title.slice(0, 120));
      return `${i + 1}. ${title} — ${escape(e.why.slice(0, 200))}`;
    });
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: clampSectionText(`*Evidence*\n${lines.join("\n")}`) },
    });
  }

  if (result.recommendedActions.length > 0) {
    const lines = result.recommendedActions.slice(0, 4).map((a, i) => `${i + 1}. ${escape(a)}`);
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: clampSectionText(`*Suggested next steps*\n${lines.join("\n")}`) },
    });
  }

  blocks.push({ type: "divider" });

  const labels = result.draftIssue.labels.length
    ? ` · ${result.draftIssue.labels.map((l) => `\`${escape(l)}\``).join(" ")}`
    : "";
  blocks.push({
    type: "section",
    text: { type: "mrkdwn", text: clampSectionText(`*Draft issue:* ${escape(result.draftIssue.title)}${labels}`) },
  });

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
        text: { type: "plain_text", text: "Create GitHub issue" },
        action_id: ACTION_CREATE_ISSUE,
        value: encodeIssuePayload({ repo, issue: result.draftIssue }),
      },
      {
        type: "button",
        text: { type: "plain_text", text: "Log resolution" },
        action_id: ACTION_MARK_RESOLVED,
        value: JSON.stringify(resolveCtx),
      },
    ],
  });

  const canvasLink = canvas?.url ? ` · <${canvas.url}|Incident canvas>` : "";
  blocks.push({
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: `Culprit · AI-generated hypothesis, not a verdict — every claim links to its source · Verify before acting${canvasLink}`,
      },
    ],
  });

  return blocks;
}

