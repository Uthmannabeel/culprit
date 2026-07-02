/**
 * Pure similarity helpers for incident recall. Kept dependency-free and
 * deterministic so they can be unit-tested without any network or model.
 */

/** Cosine similarity of two equal-length vectors. Returns 0 for degenerate input. */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] as number;
    const y = b[i] as number;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** Lowercase alphanumeric word tokens, with very short/common words dropped. */
const STOP_WORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "and", "or", "of", "to", "in", "on",
  "for", "with", "it", "this", "that", "at", "by", "from", "as", "be", "after", "since",
]);

export function tokenize(text: string): string[] {
  // Unicode-aware: letters/digits in any script count as token characters, so
  // the offline fallback isn't silently dead for non-English reports. Short
  // non-ASCII tokens are kept (CJK words are often 1-2 characters).
  const tokens = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return tokens.filter((t) => {
    if (STOP_WORDS.has(t)) return false;
    // eslint-disable-next-line no-control-regex
    return t.length > 2 || /[^\x00-\x7f]/.test(t);
  });
}

/**
 * Lexical (Jaccard) similarity over token sets — the offline fallback used when
 * embeddings are unavailable, so recall degrades gracefully instead of failing.
 */
export function lexicalSimilarity(a: string, b: string): number {
  const setA = new Set(tokenize(a));
  const setB = new Set(tokenize(b));
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const t of setA) if (setB.has(t)) intersection++;
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}
