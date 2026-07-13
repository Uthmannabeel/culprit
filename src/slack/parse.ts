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
  const url = explicit ? null : text.match(/github\.com\/([^/\s>|]+\/[^/\s>|]+)/i);
  const candidate = explicit?.[1] ?? url?.[1];
  if (candidate) {
    // "repo:acme/store." (sentence-final punctuation) must not become a repo
    // named "store." — every GitHub call would 404 with a baffling failure.
    const cleaned = candidate.replace(/[.,;:!?)\]]+$/, "");
    // GitHub owner/repo names are a narrow charset; anything else is noise
    // (and unencoded, it would inject into the REST path).
    if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(cleaned)) return cleaned;
  }
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
  // Walk NEWEST-first: in a long thread the freshest messages (right before
  // the @mention) carry the richest clues, so when the budget runs out it must
  // be the oldest messages that fall off — not the newest.
  const lines: string[] = [];
  let total = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m?.text || m.ts === triggerTs) continue;
    const line = stripMentions(m.text).slice(0, 300);
    if (!line) continue;
    if (total + line.length > maxTotal || lines.length >= maxMessages) break;
    lines.push(`- ${line}`);
    total += line.length;
  }
  return lines.reverse().join("\n");
}

/** One page of thread replies, as returned by an injected fetcher. */
export interface ThreadPage {
  messages: Array<{ text?: string; ts?: string }>;
  nextCursor?: string;
}

/**
 * Walk a paginated thread to its END, keeping only the newest `keep` messages.
 * Slack returns replies oldest-first, so a single page of a long thread holds
 * the START of the discussion — the least useful part; the freshest clues sit
 * on the last page. The fetcher is injected so this stays dependency-free and
 * unit-testable.
 */
export async function collectThreadTail(
  fetchPage: (cursor?: string) => Promise<ThreadPage>,
  keep = 50,
  maxPages = 15,
): Promise<Array<{ text?: string; ts?: string }>> {
  let tail: Array<{ text?: string; ts?: string }> = [];
  let cursor: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const res = await fetchPage(cursor);
    tail = [...tail, ...res.messages].slice(-keep);
    cursor = res.nextCursor || undefined;
    if (!cursor) return tail;
  }
  // Page cap hit with thread remaining (thousands of replies) — return what
  // was walked; thread context is best-effort by contract.
  return tail;
}

/** Memory-management commands a user can send instead of an incident report. */
export type MemoryCommand = { type: "stats" } | { type: "forget"; id: string };

export function parseMemoryCommand(report: string): MemoryCommand | null {
  const normalized = report.trim().toLowerCase();
  if (normalized === "memory" || normalized === "stats") return { type: "stats" };
  const id = report.trim().match(/^forget\s+(\S+)$/i)?.[1];
  if (id) return { type: "forget", id };
  return null;
}

/** Parse a comma-separated id list (channel ids, bot ids, …) into a lookup set. */
export function parseIdList(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean),
  );
}

/** The ALERT_CHANNELS config, as a lookup set. */
export const parseAlertChannels = parseIdList;

/**
 * Should a channel message trigger an automatic triage? Only top-level
 * messages in a configured alert channel, never our own posts (loop guard),
 * and never empty text. This is what turns Culprit from reactive-only into an
 * agent that meets alerts where they land.
 *
 * When `allowedBotIds` is non-empty, ONLY posts from those bot ids trigger —
 * auto-triage is a human-free path into the LLM, so operators can pin it to
 * their known webhook bots (Sentry, PagerDuty) instead of anything posted there.
 */
export function shouldAutoTriage(
  msg: { channel: string; channel_type?: string; thread_ts?: string; bot_id?: string; text?: string },
  alertChannels: Set<string>,
  selfBotId: string | undefined,
  allowedBotIds?: Set<string>,
): boolean {
  if (alertChannels.size === 0 || !alertChannels.has(msg.channel)) return false;
  if (msg.channel_type !== "channel" && msg.channel_type !== "group") return false;
  if (msg.thread_ts) return false; // replies (incl. our own verdicts) never re-trigger
  if (msg.bot_id && selfBotId && msg.bot_id === selfBotId) return false;
  if (allowedBotIds && allowedBotIds.size > 0 && (!msg.bot_id || !allowedBotIds.has(msg.bot_id))) return false;
  return Boolean(msg.text && msg.text.trim().length > 0);
}
