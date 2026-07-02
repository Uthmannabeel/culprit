import { describe, expect, test } from "vitest";
import { findSimilarIssue } from "./issues.js";

const open = [
  { number: 7, title: "Checkout 500s: payment API key env var renamed but not updated in prod", url: "https://x/7" },
  { number: 9, title: "Docs: fix typo in README", url: "https://x/9" },
];

describe("findSimilarIssue", () => {
  test("finds an open issue that rhymes with the draft title", () => {
    const hit = findSimilarIssue(open, "Checkout 500s after payment env var rename");
    expect(hit?.number).toBe(7);
  });

  test("returns null when nothing is close (conservative by design)", () => {
    expect(findSimilarIssue(open, "Search latency p95 regression on products index")).toBeNull();
    expect(findSimilarIssue([], "anything")).toBeNull();
  });
});
