import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { AppConfig } from "./config.js";

/**
 * Append-only JSONL audit trail for Culprit's write actions (issue filed,
 * resolution logged, memory entry forgotten) — who did what, when. Local-file
 * scope by design (see LIMITATIONS.md), but every state change leaves a
 * durable, greppable trace. Best-effort: auditing must never break the action.
 */
export async function audit(config: AppConfig, action: string, details: Record<string, unknown>): Promise<void> {
  try {
    const line = JSON.stringify({ at: new Date().toISOString(), action, ...details });
    await mkdir(dirname(config.AUDIT_LOG_PATH), { recursive: true });
    await appendFile(config.AUDIT_LOG_PATH, `${line}\n`, "utf8");
  } catch (err) {
    console.error("[audit]", err instanceof Error ? err.message : err);
  }
}
