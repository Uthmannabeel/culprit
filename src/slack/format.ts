/**
 * Shared design tokens + text-safety helpers for every surface Culprit renders
 * (Block Kit card, Canvas). One source of truth so the card and the canvas
 * never disagree about how severity or confidence is expressed.
 *
 * Design system (benchmarked against incident.io, Rootly, PagerDuty, Datadog
 * Bits AI, Sentry Seer, and Slack's Block Kit guidance):
 * - Severity: one colored circle + text label — the industry-standard signal,
 *   and the ONLY emoji allowed in rendered output.
 * - Confidence / similarity: categorical words, never percentages or bars —
 *   numeric precision on a model estimate reads as false precision.
 */

/** Rendered severity labels (colored circle + words, Rootly-style). */
export const SEVERITY_LABEL: Record<"sev1" | "sev2" | "sev3" | "unknown", string> = {
  sev1: "🔴 Critical (SEV1)",
  sev2: "🟠 Major (SEV2)",
  sev3: "🟡 Minor (SEV3)",
  unknown: "⚪ Unclassified",
};

/** Categorical confidence, each level implying an action for the responder. */
export function confidenceLabel(confidence: number): string {
  if (confidence >= 80) return "High";
  if (confidence >= 60) return "Medium";
  return "Low";
}

/** Categorical similarity for prior-incident matches. */
export function similarityLabel(similarity: number): string {
  if (similarity >= 0.85) return "Near-identical";
  if (similarity >= 0.7) return "Strong match";
  return "Possible match";
}

/**
 * Neutralise untrusted text before embedding it in canvas markdown. Reports,
 * evidence and recalled memory are user/model-controlled — without this a
 * reporter could inject fake links, headings, or a bogus resolution section
 * into a bot-authored, channel-shared doc (content spoofing / phishing).
 */
export function mdSafe(text: string): string {
  // Collapse newlines first so untrusted text can never start a line (which
  // neutralises heading/list/blockquote markers), then escape the inline-active
  // characters that could still inject a link, code span, emphasis, or table.
  return text
    .replace(/[\r\n]+/g, " ")
    .replace(/([`[\]<>|*])/g, "\\$1")
    .trim();
}

/** Return the URL only if it's a well-formed http(s) link, else null. */
export function safeHttpUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}
