import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { AppConfig } from "../config.js";
import { embedTexts } from "./embeddings.js";
import { cosineSimilarity, lexicalSimilarity } from "./similarity.js";
import { IncidentRecordSchema, recordText, type IncidentRecord, type RecallHit } from "./types.js";

/**
 * Culprit's institutional memory: every incident the org has worked through,
 * stored as JSON and recalled by semantic similarity (with a lexical fallback
 * so it still works offline). This is the asset other triage tools don't have —
 * it lives in your Slack/GitHub history and compounds with every incident.
 */
export class IncidentMemory {
  private records: IncidentRecord[] = [];
  private loaded = false;

  constructor(
    private readonly config: AppConfig,
    private readonly path: string = config.INCIDENTS_DB_PATH,
  ) {}

  /** Load records from disk. Missing file = empty memory (not an error). */
  async load(): Promise<void> {
    try {
      const raw = await readFile(this.path, "utf8");
      const parsed: unknown = JSON.parse(raw);
      const list = Array.isArray(parsed) ? parsed : [];
      this.records = list.map((r) => IncidentRecordSchema.parse(r));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") this.records = [];
      else throw err;
    }
    this.loaded = true;
  }

  /** How many incidents are remembered. */
  size(): number {
    return this.records.length;
  }

  /**
   * Find the incidents most similar to a new report. Tries embeddings first;
   * on any embedding failure, falls back to lexical similarity for the whole
   * set so a recall always returns a ranked, honest answer.
   */
  async recall(query: string, k: number = this.config.MEMORY_RECALL_K): Promise<RecallHit[]> {
    if (!this.loaded) await this.load();
    if (this.records.length === 0) return [];

    const hits = (await this.tryEmbeddingRecall(query)) ?? this.lexicalRecall(query);
    // Thresholds are method-specific: embedding cosine and lexical Jaccard have
    // very different score distributions (see config comments).
    return hits
      .filter((h) => h.score >= this.minScoreFor(h.method))
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }

  private minScoreFor(method: RecallHit["method"]): number {
    return method === "lexical" ? this.config.MEMORY_MIN_SCORE_LEXICAL : this.config.MEMORY_MIN_SCORE;
  }

  /** Embedding-based ranking; returns null if embeddings are unavailable. */
  private async tryEmbeddingRecall(query: string): Promise<RecallHit[] | null> {
    try {
      const needEmbedding = this.records.filter((r) => !r.embedding);
      const texts = [query, ...needEmbedding.map((r) => recordText(r))];
      const [queryVec, ...freshVecs] = await embedTexts(this.config, texts);
      if (!queryVec) return null;
      needEmbedding.forEach((r, i) => (r.embedding = freshVecs[i] ?? null));

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

  /** Record a (usually resolved) incident and persist it. Embedding best-effort. */
  async remember(record: IncidentRecord): Promise<void> {
    if (!this.loaded) await this.load();
    if (!record.embedding) {
      try {
        const [vec] = await embedTexts(this.config, [recordText(record)]);
        record.embedding = vec ?? null;
      } catch {
        record.embedding = null; // keep going; lexical recall still works
      }
    }
    this.records = [...this.records.filter((r) => r.id !== record.id), record];
    await this.save();
  }

  private async save(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, JSON.stringify(this.records, null, 2), "utf8");
  }
}
