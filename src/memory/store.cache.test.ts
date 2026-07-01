import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { mkdtemp, writeFile, readFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AppConfig } from "../config.js";

// Deterministic fake embeddings so we can exercise the EMBEDDING path (the
// other store tests force the lexical fallback).
vi.mock("./embeddings.js", () => ({
  embedTexts: vi.fn(async (_config: unknown, texts: string[]) =>
    texts.map((t) => [t.length % 7, (t.charCodeAt(0) ?? 1) % 5, 1]),
  ),
}));

import { embedTexts } from "./embeddings.js";
import { IncidentMemory } from "./store.js";
import type { IncidentRecord } from "./types.js";

const SEED = [
  { id: "a", symptom: "payments failing at checkout", resolution: "restored env var" },
  { id: "b", symptom: "login redirect loop", resolution: "samesite lax" },
];

let dir: string;
let dbPath: string;

function makeConfig(): AppConfig {
  return {
    INCIDENTS_DB_PATH: dbPath,
    MEMORY_RECALL_K: 3,
    MEMORY_MIN_SCORE: 0, // not under test here
    MEMORY_MIN_SCORE_LEXICAL: 0,
    EMBEDDING_MODEL: "gemini-embedding-001",
    GEMINI_API_KEY: "unused",
  } as AppConfig;
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "culprit-cache-"));
  dbPath = join(dir, "incidents.json");
  await writeFile(dbPath, JSON.stringify(SEED), "utf8");
  vi.mocked(embedTexts).mockClear();
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("embedding sidecar cache", () => {
  test("first recall computes + persists vectors; a new process reuses them", async () => {
    const first = new IncidentMemory(makeConfig());
    await first.recall("checkout 500s");

    // Cache file written next to the db.
    await expect(access(`${dbPath}.cache.json`)).resolves.toBeUndefined();

    // A fresh instance (≈ new process) should only embed the QUERY, not the records.
    vi.mocked(embedTexts).mockClear();
    const second = new IncidentMemory(makeConfig());
    await second.recall("another report");
    expect(vi.mocked(embedTexts)).toHaveBeenCalledTimes(1);
    const texts = vi.mocked(embedTexts).mock.calls[0]?.[1] as string[];
    expect(texts).toEqual(["another report"]);
  });

  test("remember() keeps the main file vector-free (diffable) with the vector cached", async () => {
    const memory = new IncidentMemory(makeConfig());
    await memory.remember({
      id: "c", symptom: "emails not sending", rootCause: "rotated key", resolution: "deployed key",
      resolvedBy: "priya", links: [], repo: null, createdAt: "", hypothesisWasCorrect: true, embedding: null,
    });

    const onDisk = JSON.parse(await readFile(dbPath, "utf8")) as IncidentRecord[];
    for (const r of onDisk) expect(r.embedding).toBeNull();

    const cache = JSON.parse(await readFile(`${dbPath}.cache.json`, "utf8")) as Record<string, { vector: number[] }>;
    expect(cache.c?.vector).toBeDefined();
  });
});
