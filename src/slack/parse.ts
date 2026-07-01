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
