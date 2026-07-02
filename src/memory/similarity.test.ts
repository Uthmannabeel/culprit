import { describe, expect, test } from "vitest";
import { cosineSimilarity, lexicalSimilarity, tokenize } from "./similarity.js";

describe("cosineSimilarity", () => {
  test("returns 1 for identical vectors", () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1);
  });

  test("returns 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
  });

  test("returns 0 for mismatched or empty lengths", () => {
    expect(cosineSimilarity([1, 2], [1])).toBe(0);
    expect(cosineSimilarity([], [])).toBe(0);
  });

  test("ranks a closer vector higher", () => {
    const q = [1, 1, 0];
    const near = cosineSimilarity(q, [1, 1, 0.2]);
    const far = cosineSimilarity(q, [0, 0, 1]);
    expect(near).toBeGreaterThan(far);
  });
});

describe("tokenize", () => {
  test("lowercases, splits, and drops stop/short words", () => {
    expect(tokenize("The Checkout is throwing 500s")).toEqual(["checkout", "throwing", "500s"]);
  });
});

describe("tokenize (non-English)", () => {
  test("keeps non-Latin scripts instead of dropping them", () => {
    expect(tokenize("оплата не работает")).toEqual(["оплата", "не", "работает"]);
    expect(tokenize("支払いが失敗")).toContain("支払いが失敗");
  });
});

describe("lexicalSimilarity", () => {
  test("works for non-English reports", () => {
    const related = lexicalSimilarity("оплата не работает на кассе", "касса: оплата не работает после деплоя");
    expect(related).toBeGreaterThan(0.3);
  });

  test("scores overlapping symptoms above unrelated ones", () => {
    const query = "checkout returning 500 errors after deploy";
    const related = lexicalSimilarity(query, "payments failing at checkout with 500 after a deploy");
    const unrelated = lexicalSimilarity(query, "search latency spiked over the weekend");
    expect(related).toBeGreaterThan(unrelated);
  });

  test("returns 0 when there is no shared vocabulary", () => {
    expect(lexicalSimilarity("alpha beta gamma", "delta epsilon zeta")).toBe(0);
  });
});
