import { randomUUID } from "node:crypto";
import type { DraftIssue } from "../github/issues.js";

/**
 * Slack hard-caps a button's `value` at 2000 characters, and a drafted issue
 * body alone can exceed that — which would make the WHOLE verdict card fail to
 * post (`invalid_blocks`). Strategy: inline the payload when it fits (survives
 * restarts), otherwise park it here and put only a short id in the button.
 */
export interface IssuePayload {
  repo: string;
  issue: DraftIssue;
}

/** Leave headroom under Slack's 2000-char limit for safety. */
const MAX_INLINE_VALUE = 1900;
/** Bound memory: oldest drafts are evicted first. */
const MAX_STORED = 200;

const stored = new Map<string, IssuePayload>();

/** Encode a payload for a button value, spilling to the store if oversized. */
export function encodeIssuePayload(payload: IssuePayload): string {
  const inline = JSON.stringify(payload);
  if (inline.length <= MAX_INLINE_VALUE) return inline;

  const id = randomUUID();
  stored.set(id, payload);
  if (stored.size > MAX_STORED) {
    const oldest = stored.keys().next().value;
    if (oldest) stored.delete(oldest);
  }
  return JSON.stringify({ draftId: id });
}

/**
 * Decode a button value back into a payload. Returns null when the value is
 * malformed or references a draft this process no longer holds (e.g. after a
 * restart) — callers should tell the user to re-run triage.
 */
export function decodeIssuePayload(value: string | undefined): IssuePayload | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<IssuePayload> & { draftId?: string };
    if (parsed.draftId) return stored.get(parsed.draftId) ?? null;
    if (typeof parsed.repo === "string" && parsed.issue && typeof parsed.issue.title === "string") {
      return parsed as IssuePayload;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Idempotency for the Create-issue button: Slack can't disable a clicked
 * button, so a double-click would file the issue twice. Track what's been
 * filed (keyed by the button's raw value, unique per card) and short-circuit
 * repeat clicks with the existing issue URL.
 */
const filed = new Map<string, string>();
const MAX_FILED = 500;

export function markFiled(value: string | undefined, issueUrl: string): void {
  if (!value) return;
  filed.set(value, issueUrl);
  if (filed.size > MAX_FILED) {
    const oldest = filed.keys().next().value;
    if (oldest) filed.delete(oldest);
  }
}

export function alreadyFiledUrl(value: string | undefined): string | null {
  if (!value) return null;
  return filed.get(value) ?? null;
}

/** Test hook: reset the in-process stores. */
export function clearDraftStore(): void {
  stored.clear();
  filed.clear();
}
