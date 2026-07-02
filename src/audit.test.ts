import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { audit } from "./audit.js";
import type { AppConfig } from "./config.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "culprit-audit-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("audit", () => {
  test("appends one JSONL line per action with timestamp and details", async () => {
    const config = { AUDIT_LOG_PATH: join(dir, "audit.jsonl") } as AppConfig;
    await audit(config, "issue_filed", { repo: "acme/store", issue: 7, actor: "U1" });
    await audit(config, "memory_forgotten", { id: "inc-1", actor: "U2" });

    const lines = (await readFile(config.AUDIT_LOG_PATH, "utf8")).trim().split("\n");
    expect(lines).toHaveLength(2);
    const first = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(first.action).toBe("issue_filed");
    expect(first.actor).toBe("U1");
    expect(typeof first.at).toBe("string");
  });

  test("never throws even when the path is unwritable", async () => {
    const config = { AUDIT_LOG_PATH: join(dir, "no\0pe", "audit.jsonl") } as AppConfig;
    await expect(audit(config, "x", {})).resolves.toBeUndefined();
  });
});
