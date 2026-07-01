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

function makeConfig(over: Partial<AppConfig> = {}): AppConfig {
  return {
    INCIDENTS_DB_PATH: dbPath,
    MEMORY_RECALL_K: 3,
    MEMORY_MIN_SCORE: 0.05,
    MEMORY_MIN_SCORE_LEXICAL: 0.05,
    EMBEDDING_MODEL: "gemini-embedding-001",
    GEMINI_API_KEY: "unused",
    ...over,
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
    const memory = new IncidentMemory(makeConfig({ MEMORY_MIN_SCORE_LEXICAL: 0.9 }));
    const hits = await memory.recall("the homepage banner colour looks off");
    expect(hits).toEqual([]);
  });

  test("lexical fallback still recalls at the embedding-tuned default threshold (H2 regression)", async () => {
    // Embedding floor is high (0.7) but the offline fallback must not be gated by
    // it — a related report should still surface via the lexical threshold.
    const memory = new IncidentMemory(makeConfig({ MEMORY_MIN_SCORE: 0.7, MEMORY_MIN_SCORE_LEXICAL: 0.1 }));
    const hits = await memory.recall("checkout returning 500 errors after a deploy");
    expect(hits[0]?.record.id).toBe("a");
    expect(hits[0]?.method).toBe("lexical");
  });

  test("empty memory recalls nothing", async () => {
    await writeFile(dbPath, "[]", "utf8");
    const memory = new IncidentMemory(makeConfig());
    expect(await memory.recall("anything")).toEqual([]);
  });
});

describe("IncidentMemory.forget", () => {
  test("removes an entry by id and persists", async () => {
    const memory = new IncidentMemory(makeConfig());
    expect(await memory.forget("b")).toBe(true);
    const onDisk = JSON.parse(await readFile(dbPath, "utf8")) as IncidentRecord[];
    expect(onDisk.map((r) => r.id)).toEqual(["a", "c"]);
  });

  test("returns false for an unknown id", async () => {
    const memory = new IncidentMemory(makeConfig());
    expect(await memory.forget("nope")).toBe(false);
  });
});

describe("IncidentMemory.stats", () => {
  test("aggregates resolutions and hypothesis outcomes", async () => {
    const memory = new IncidentMemory(makeConfig());
    const stats = await memory.stats();
    // All 3 seeds have a resolution; none carry an explicit outcome → partial.
    expect(stats).toEqual({
      incidents: 3,
      resolved: 3,
      hypothesisCorrect: 0,
      hypothesisPartial: 3,
      hypothesisIncorrect: 0,
    });
  });
});

describe("IncidentMemory.remember", () => {
  function fullRecord(id: string): IncidentRecord {
    return {
      id, symptom: `symptom ${id}`, rootCause: "cause", resolution: "fix", resolvedBy: "sam",
      links: [], repo: null, createdAt: "2026-07-01T00:00:00Z", hypothesisWasCorrect: true, embedding: null,
    };
  }

  test("concurrent remembers from separate instances don't lose updates", async () => {
    const a = new IncidentMemory(makeConfig());
    const b = new IncidentMemory(makeConfig());

    await Promise.all([a.remember(fullRecord("race-x")), b.remember(fullRecord("race-y"))]);

    const onDisk = JSON.parse(await readFile(dbPath, "utf8")) as IncidentRecord[];
    const ids = onDisk.map((r) => r.id);
    expect(ids).toContain("race-x");
    expect(ids).toContain("race-y");
    expect(onDisk).toHaveLength(SEED.length + 2);
  });

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
