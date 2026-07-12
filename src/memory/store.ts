import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { dirname } from "node:path";
import type { AppConfig } from "../config.js";
import { embedTexts } from "./embeddings.js";
import { cosineSimilarity, lexicalSimilarity } from "./similarity.js";
import { IncidentRecordSchema, recordText, type IncidentRecord, type RecallHit } from "./types.js";

/**
 * Sidecar embedding cache: record id → the exact text that was embedded plus
 * its vector. Kept OUT of the main incidents file so that file stays small,
 * human-readable, and git-diffable (a 3072-float vector per record would
 * swamp every diff). Entries invalidate automatically when the text changes.
 */
interface EmbeddingCacheEntry {
  text: string;
  vector: number[];
}
type EmbeddingCache = Record<string, EmbeddingCacheEntry>;

/** Aggregate outcomes across the remembered incidents. */
export interface MemoryStats {
  incidents: number;
  resolved: number;
  hypothesisCorrect: number;
  hypothesisPartial: number;
  hypothesisIncorrect: number;
}

/**
 * Serialise writes per db path so concurrent remember() calls (two responders
 * resolving incidents at once) can't lose updates through read-modify-write
 * interleaving on the JSON file.
 */
/** Write via temp-file + rename so a crash mid-write can't corrupt the store. */
async function atomicWrite(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, content, "utf8");
  await rename(tmp, path);
}

const writeLocks = new Map<string, Promise<unknown>>();
async function withWriteLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = writeLocks.get(key) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  writeLocks.set(
    key,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}

/**
 * Culprit's institutional memory: every incident the org has worked through,
 * stored as JSON and recalled by semantic similarity (with a lexical fallback
 * so it still works offline). This is the asset other triage tools don't have —
 * it lives in your Slack/GitHub history and compounds with every incident.
 */
export class IncidentMemory {
  private records: IncidentRecord[] = [];
  private loaded = false;
  private cacheAttached = false;
  private readonly cachePath: string;

  constructor(
    private readonly config: AppConfig,
    private readonly path: string = config.INCIDENTS_DB_PATH,
  ) {
    this.cachePath = `${this.path}.cache.json`;
  }

  /**
   * Load records from disk (missing file = empty memory, not an error). The
   * vector sidecar (3072 floats × N records — the largest file in the system)
   * is NOT parsed here: stats()/forget() never need vectors, so only the
   * embedding-recall path pays that cost, lazily.
   */
  async load(): Promise<void> {
    this.records = await this.readRecords();
    this.cacheAttached = false;
    this.loaded = true;
  }

  /** How many incidents are remembered. */
  size(): number {
    return this.records.length;
  }

  /**
   * Culprit's earned track record, computed from logged outcomes — the basis
   * for the App Home "how well does it actually do here?" panel. Only
   * incidents with a recorded resolution count; hypothesis outcomes are
   * correct (true) / partially correct (null) / incorrect (false).
   */
  async stats(): Promise<MemoryStats> {
    if (!this.loaded) await this.load();
    const resolved = this.records.filter((r) => r.resolution.length > 0);
    return {
      incidents: this.records.length,
      resolved: resolved.length,
      hypothesisCorrect: resolved.filter((r) => r.hypothesisWasCorrect === true).length,
      hypothesisPartial: resolved.filter((r) => r.hypothesisWasCorrect === null).length,
      hypothesisIncorrect: resolved.filter((r) => r.hypothesisWasCorrect === false).length,
    };
  }

  /**
   * Find the incidents most similar to a new report. Tries embeddings first;
   * on any embedding failure, falls back to lexical similarity for the whole
   * set so a recall always returns a ranked, honest answer.
   */
  async recall(query: string, k: number = this.config.MEMORY_RECALL_K, repoHint?: string): Promise<RecallHit[]> {
    if (!this.loaded) await this.load();
    if (this.records.length === 0) return [];

    const raw = (await this.tryEmbeddingRecall(query)) ?? this.lexicalRecall(query);
    // Same-repo incidents get a small boost — precedent from the same system is
    // stronger evidence than a rhyme from elsewhere (cross-repo matches still
    // surface, but labeled with their origin downstream).
    const hits = raw.map((h) =>
      repoHint && h.record.repo && h.record.repo.toLowerCase() === repoHint.toLowerCase()
        ? { ...h, score: Math.min(1, h.score + 0.05) }
        : h,
    );
    // Thresholds are method-specific: embedding cosine and lexical Jaccard have
    // very different score distributions (see config comments).
    return hits
      .filter((h) => h.score >= this.minScoreFor(h.method))
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }

  /** Record a (usually resolved) incident and persist it. Embedding best-effort. */
  async remember(record: IncidentRecord): Promise<void> {
    await this.rememberMany([record]);
  }

  /**
   * Record a batch in ONE embedding call and ONE persisted write. The issue
   * importer used to do one API round-trip and one full store rewrite PER
   * record — O(n²) serialization and rate-limit churn for a 50-issue import.
   * Never mutates the caller's records (embeddings land on copies).
   */
  async rememberMany(records: IncidentRecord[]): Promise<void> {
    if (records.length === 0) return;
    // Embed OUTSIDE the write lock — a slow network call shouldn't block other writers.
    const withVectors = await this.embedMissing(records);
    await withWriteLock(this.path, async () => {
      // Re-read inside the lock so a concurrent writer's record isn't lost.
      this.records = await this.readRecords();
      this.cacheAttached = false;
      const ids = new Set(withVectors.map((r) => r.id));
      this.records = [...this.records.filter((r) => !ids.has(r.id)), ...withVectors];
      await this.save();
      await this.saveCache();
    });
    this.loaded = true;
  }

  /** Copies of `records` with embeddings filled in where missing (best-effort). */
  private async embedMissing(records: IncidentRecord[]): Promise<IncidentRecord[]> {
    const missing = records.filter((r) => !r.embedding);
    if (missing.length === 0) return records.map((r) => ({ ...r }));
    let vectors: Array<number[] | null> = missing.map(() => null);
    try {
      const embedded = await embedTexts(this.config, missing.map((r) => recordText(r)));
      vectors = missing.map((_, i) => embedded[i] ?? null);
    } catch {
      // keep going; lexical recall still works
    }
    const vectorById = new Map(missing.map((r, i) => [r.id, vectors[i] ?? null]));
    return records.map((r) => (r.embedding ? { ...r } : { ...r, embedding: vectorById.get(r.id) ?? null }));
  }

  /**
   * Remove a remembered incident by id — the moderation/undo path for a wrong
   * or poisoned entry. Returns whether anything was removed.
   */
  async forget(id: string): Promise<boolean> {
    let removed = false;
    await withWriteLock(this.path, async () => {
      this.records = await this.readRecords();
      this.cacheAttached = false;
      const before = this.records.length;
      this.records = this.records.filter((r) => r.id !== id);
      removed = this.records.length < before;
      if (removed) {
        await this.save();
        await this.saveCache();
      }
    });
    this.loaded = true;
    return removed;
  }

  private minScoreFor(method: RecallHit["method"]): number {
    return method === "lexical" ? this.config.MEMORY_MIN_SCORE_LEXICAL : this.config.MEMORY_MIN_SCORE;
  }

  /** Embedding-based ranking; returns null if embeddings are unavailable. */
  private async tryEmbeddingRecall(query: string): Promise<RecallHit[] | null> {
    try {
      // Only this path needs vectors — attach the sidecar cache on first use.
      if (!this.cacheAttached) {
        await this.attachCachedEmbeddings();
        this.cacheAttached = true;
      }
      const needEmbedding = this.records.filter((r) => !r.embedding);
      const texts = [query, ...needEmbedding.map((r) => recordText(r))];
      const [queryVec, ...freshVecs] = await embedTexts(this.config, texts);
      if (!queryVec) return null;
      const freshById = new Map(needEmbedding.map((r, i) => [r.id, freshVecs[i] ?? null]));
      this.records = this.records.map((r) =>
        !r.embedding && freshById.has(r.id) ? { ...r, embedding: freshById.get(r.id) ?? null } : r,
      );
      // Persist newly computed vectors so the next process doesn't re-embed.
      if (needEmbedding.length > 0) await this.saveCache();

      return this.records.map((record) => ({
        record,
        score: record.embedding ? cosineSimilarity(queryVec, record.embedding) : 0,
        method: "embedding" as const,
      }));
    } catch {
      return null;
    }
  }

  /** Offline ranking by token-overlap similarity. */
  private lexicalRecall(query: string): RecallHit[] {
    return this.records.map((record) => ({
      record,
      score: lexicalSimilarity(query, recordText(record)),
      method: "lexical" as const,
    }));
  }

  private async readRecords(): Promise<IncidentRecord[]> {
    try {
      const raw = await readFile(this.path, "utf8");
      const parsed: unknown = JSON.parse(raw);
      const list = Array.isArray(parsed) ? parsed : [];
      return list.map((r) => IncidentRecordSchema.parse(r));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
  }

  /** Attach cached vectors to loaded records (skipping any whose text changed). */
  private async attachCachedEmbeddings(): Promise<void> {
    const cache = await this.readCache();
    this.records = this.records.map((record) => {
      const entry = cache[record.id];
      return !record.embedding && entry && entry.text === recordText(record)
        ? { ...record, embedding: entry.vector }
        : record;
    });
  }

  private async readCache(): Promise<EmbeddingCache> {
    try {
      return JSON.parse(await readFile(this.cachePath, "utf8")) as EmbeddingCache;
    } catch {
      return {}; // cache is best-effort; absence just means re-embedding
    }
  }

  private async saveCache(): Promise<void> {
    // MERGE with the on-disk cache rather than rebuilding from records: with
    // lazy attachment the in-memory records may not carry vectors the sidecar
    // already has, and a rebuild would silently drop them (forcing re-embeds).
    const cache = await this.readCache();
    const liveIds = new Set(this.records.map((r) => r.id));
    for (const id of Object.keys(cache)) {
      if (!liveIds.has(id)) delete cache[id];
    }
    for (const r of this.records) {
      if (r.embedding) cache[r.id] = { text: recordText(r), vector: r.embedding };
    }
    try {
      await atomicWrite(this.cachePath, JSON.stringify(cache));
    } catch {
      // best-effort — worst case is a re-embed on the next process start
    }
  }

  private async save(): Promise<void> {
    // Vectors live in the sidecar cache; keep this file clean and diffable.
    const clean = this.records.map((r) => ({ ...r, embedding: null }));
    await atomicWrite(this.path, JSON.stringify(clean, null, 2));
  }
}
