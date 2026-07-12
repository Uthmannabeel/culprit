import type { KnownBlock } from "@slack/types";
import type { TriageResult } from "../triage/types.js";
import { ACTION_MARK_RESOLVED, type ResolveContext } from "./resolve.js";
import {
  SEVERITY_LABEL,
  clampSectionText,
  confidenceLabel,
  escapeMrkdwn as escape,
  evidenceLinkUrl,
  linkLabel,
  safeHttpUrl,
  similarityLabel,
} from "./format.js";
import { encodeIssuePayload, encodeResolveContext } from "./draftStore.js";

/** Action IDs for interactive components. */
export const ACTION_CREATE_ISSUE = "triage_create_issue";

/** How much of the draft-issue body the card previews before filing. */
const ISSUE_BODY_PREVIEW_LINES = 8;
const ISSUE_BODY_PREVIEW_CHARS = 500;

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
      // Precedent from a different system is a weaker claim — say where it's from.
      const origin = p.repo && p.repo.toLowerCase() !== repo.toLowerCase() ? ` _(in \`${escape(p.repo)}\`)_` : "";
      return `*${similarityLabel(p.similarity)}*${origin} — ${escape(p.symptom.slice(0, 200))}${ref}.${who}${fix}`;
    });
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: clampSectionText(`*Prior incident match*\n${lines.join("\n")}`) },
    });
  }

  if (result.evidence.length > 0) {
    const lines = result.evidence.slice(0, 6).map((e, i) => {
      // GitHub-kind evidence must link to GitHub — the URL is model output and
      // a spoofed link under the bot's authority is a phishing vector.
      const url = evidenceLinkUrl(e.kind, e.url);
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

  // Show what the button will actually file. Without a preview the human
  // approves a body they never saw — injected content could hide @mentions,
  // spoofed links, or leaked file contents behind a benign title.
  const bodyPreview = result.draftIssue.body
    .split("\n")
    .slice(0, ISSUE_BODY_PREVIEW_LINES)
    .join("\n")
    .slice(0, ISSUE_BODY_PREVIEW_CHARS);
  if (bodyPreview.trim()) {
    const truncated = bodyPreview.length < result.draftIssue.body.length;
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: clampSectionText(`>${escape(bodyPreview).replace(/\n/g, "\n>")}${truncated ? "\n>…" : ""}`),
      },
    });
  }

  // The link is stored in memory and re-surfaced on future recalls — only a
  // validated URL may travel that far.
  const evidenceLink =
    result.evidence.map((e) => evidenceLinkUrl(e.kind, e.url)).find((u): u is string => Boolean(u)) ?? null;
  const resolveCtx: ResolveContext = {
    symptom: (report ?? result.summary).slice(0, 300),
    hypothesis: result.rootCauseHypothesis.slice(0, 600),
    repo,
    suspectedOwner: result.suspectedOwner,
    link: (evidenceLink ?? safeHttpUrl(result.priorIncidents[0]?.url))?.slice(0, 500) ?? null,
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
        // Spill-safe like the issue payload — an oversized value rejects the
        // WHOLE card, the exact failure this file exists to prevent.
        value: encodeResolveContext(resolveCtx),
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

