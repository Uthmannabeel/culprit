/**
 * Pure text helpers for incoming Slack messages. Kept dependency-free so
 * they're trivially unit-testable — these run on every report, and a parsing
 * slip here surfaces to users as a baffling "couldn't complete triage".
 */

/**
 * Pull an explicit repo out of the message text, else fall back to default.
 * Handles Slack's link formatting: URLs arrive as `<https://github.com/o/r>`
 * or `<https://github.com/o/r|label>`, so `>` and `|` must terminate the match.
 */
export function parseRepo(text: string, fallback?: string): string | undefined {
  const explicit = text.match(/\brepo:([^/\s>|]+\/[^/\s>|]+)/i);
  if (explicit) return explicit[1];
  const url = text.match(/github\.com\/([^/\s>|]+\/[^/\s>|]+)/i);
  if (url) return url[1];
  return fallback;
}

/** Strip bot mentions like "<@U123>" from the report text. */
export function stripMentions(text: string): string {
  return text.replace(/<@[^>]+>/g, "").trim();
}

/**
 * Format prior thread messages as investigation context. When Culprit is
 * mentioned inside an ongoing discussion, the thread usually carries the
 * richest clues (what people tried, error snippets, timings) — ignoring it
 * wastes the best context in the room. The trigger message itself is excluded;
 * text is mention-stripped and size-capped so it can't blow the prompt budget.
 */
export function formatThreadContext(
  messages: Array<{ text?: string; ts?: string }>,
  triggerTs: string,
  maxMessages = 12,
  maxTotal = 2500,
): string {
  const lines: string[] = [];
  let total = 0;
  for (const m of messages) {
    if (!m.text || m.ts === triggerTs) continue;
    const line = stripMentions(m.text).slice(0, 300);
    if (!line) continue;
    if (total + line.length > maxTotal) break;
    lines.push(`- ${line}`);
    total += line.length;
  }
  return lines.slice(-maxMessages).join("\n");
}

/** Memory-management commands a user can send instead of an incident report. */
export type MemoryCommand = { type: "stats" } | { type: "forget"; id: string };

export function parseMemoryCommand(report: string): MemoryCommand | null {
  const normalized = report.trim().toLowerCase();
  if (normalized === "memory" || normalized === "stats") return { type: "stats" };
  const forget = report.trim().match(/^forget\s+(\S+)$/i);
  if (forget) return { type: "forget", id: forget[1]! };
  return null;
}

/** Parse the comma-separated ALERT_CHANNELS config into a lookup set. */
export function parseAlertChannels(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean),
  );
}

/**
 * Should a channel message trigger an automatic triage? Only top-level
 * messages in a configured alert channel, never our own posts (loop guard),
 * and never empty text. This is what turns Culprit from reactive-only into an
 * agent that meets alerts where they land.
 */
export function shouldAutoTriage(
  msg: { channel: string; channel_type?: string; thread_ts?: string; bot_id?: string; text?: string },
  alertChannels: Set<string>,
  selfBotId: string | undefined,
): boolean {
  if (alertChannels.size === 0 || !alertChannels.has(msg.channel)) return false;
  if (msg.channel_type !== "channel" && msg.channel_type !== "group") return false;
  if (msg.thread_ts) return false; // replies (incl. our own verdicts) never re-trigger
  if (msg.bot_id && selfBotId && msg.bot_id === selfBotId) return false;
  return Boolean(msg.text && msg.text.trim().length > 0);
}
