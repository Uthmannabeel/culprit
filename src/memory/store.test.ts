import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AppConfig } from "../config.js";

// Force the embedding path to fail so the store falls back to lexical matching —
// keeps these tests offline and deterministic.
vi.mock("./embeddings.js", () => ({
  embedTexts: vi.fn(async () => {
    throw new Error("offline");
  }),
}));

import { IncidentMemory } from "./store.js";
import type { IncidentRecord } from "./types.js";

const SEED: Array<Partial<IncidentRecord>> = [
  { id: "a", symptom: "payments failing at checkout with 500 after a deploy", rootCause: "missing payment env var", resolution: "restored the env var", resolvedBy: "dana", links: ["https://x/pr/1"] },
  { id: "b", symptom: "users stuck in a login redirect loop", rootCause: "cookie samesite strict", resolution: "set samesite lax", resolvedBy: "priya", links: [] },
  { id: "c", symptom: "search latency spiked over the weekend", rootCause: "dropped index", resolution: "recreated index", resolvedBy: "sam", links: [] },
];

let dir: string;
let dbPath: string;

function makeConfig(): AppConfig {
  return {
    INCIDENTS_DB_PATH: dbPath,
    MEMORY_RECALL_K: 3,
    MEMORY_MIN_SCORE: 0.05,
    EMBEDDING_MODEL: "text-embedding-004",
    GEMINI_API_KEY: "unused",
  } as AppConfig;
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "culprit-mem-"));
  dbPath = join(dir, "incidents.json");
  await writeFile(dbPath, JSON.stringify(SEED), "utf8");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("IncidentMemory.recall (lexical fallback)", () => {
  test("surfaces the most similar past incident first", async () => {
    const memory = new IncidentMemory(makeConfig());
    const hits = await memory.recall("checkout is throwing 500s since this morning");

    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.record.id).toBe("a");
    expect(hits[0]?.method).toBe("lexical");
  });

  test("returns nothing when below the min score", async () => {
    const cfg = { ...makeConfig(), MEMORY_MIN_SCORE: 0.9 } as AppConfig;
    const memory = new IncidentMemory(cfg);
    const hits = await memory.recall("the homepage banner colour looks off");
    expect(hits).toEqual([]);
  });

  test("empty memory recalls nothing", async () => {
    await writeFile(dbPath, "[]", "utf8");
    const memory = new IncidentMemory(makeConfig());
    expect(await memory.recall("anything")).toEqual([]);
  });
});

describe("IncidentMemory.remember", () => {
  test("persists a new incident", async () => {
    const memory = new IncidentMemory(makeConfig());
    await memory.load();
    await memory.remember({
      id: "d",
      symptom: "webhooks dropped",
      rootCause: "consumer OOM",
      resolution: "raised memory limit",
      resolvedBy: "sam",
      links: [],
      repo: null,
      createdAt: "2026-06-01T00:00:00Z",
      hypothesisWasCorrect: true,
      embedding: null,
    });

    const onDisk = JSON.parse(await readFile(dbPath, "utf8")) as IncidentRecord[];
    expect(onDisk.map((r) => r.id)).toContain("d");
    expect(onDisk).toHaveLength(SEED.length + 1);
  });
});
