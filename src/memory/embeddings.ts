import { GoogleGenAI } from "@google/genai";
import type { AppConfig } from "../config.js";
import { withRetry } from "../util/retry.js";

/**
 * Thin wrapper over Gemini's embedding API. Returns one vector per input text,
 * in order. Throws on failure so callers can fall back to lexical matching —
 * recall should degrade, never crash.
 */
export async function embedTexts(config: AppConfig, texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const ai = new GoogleGenAI({ apiKey: config.GEMINI_API_KEY });
  const res = await withRetry(() => ai.models.embedContent({ model: config.EMBEDDING_MODEL, contents: texts }));
  const embeddings = res.embeddings ?? [];
  if (embeddings.length !== texts.length) {
    throw new Error(`Embedding count mismatch: asked for ${texts.length}, got ${embeddings.length}`);
  }
  return embeddings.map((e, i) => {
    const values = e.values;
    if (!values || values.length === 0) throw new Error(`Empty embedding for input ${i}`);
    return values;
  });
}

/** Embed a single text, returning its vector. */
export async function embedText(config: AppConfig, text: string): Promise<number[]> {
  const [vec] = await embedTexts(config, [text]);
  if (!vec) throw new Error("Embedding returned no vector");
  return vec;
}
