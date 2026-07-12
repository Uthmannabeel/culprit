import { describe, expect, test } from "vitest";
import { recallToModel, toPriorIncidents } from "./recall.js";
import type { RecallHit } from "../memory/types.js";
import type { IncidentRecord } from "../memory/types.js";

function record(id: string, over: Partial<IncidentRecord> = {}): IncidentRecord {
  return {
    id, symptom: `symptom ${id}`, rootCause: "", resolution: `fix ${id}`, resolvedBy: "dana",
    links: [`https://x/${id}`], repo: null, createdAt: "", hypothesisWasCorrect: null, embedding: null, ...over,
  };
}

function hit(id: string, score: number, method: RecallHit["method"] = "embedding"): RecallHit {
  return { record: record(id), score, method };
}

describe("toPriorIncidents", () => {
  test("dedupes by id keeping the highest score, sorted strongest-first", () => {
    const out = toPriorIncidents([hit("a", 0.6), hit("b", 0.9), hit("a", 0.8)]);
    expect(out.map((p) => p.id)).toEqual(["b", "a"]);
    expect(out.find((p) => p.id === "a")?.similarity).toBe(0.8);
  });

  test("maps the first link to url and rounds similarity", () => {
    const [p] = toPriorIncidents([hit("a", 0.12345)]);
    expect(p?.url).toBe("https://x/a");
    expect(p?.similarity).toBe(0.123);
  });

  test("empty in, empty out", () => {
    expect(toPriorIncidents([])).toEqual([]);
  });
});

describe("recallToModel", () => {
  test("exposes resolution, who, and how it matched to the model", () => {
    const [first] = recallToModel([hit("a", 0.77, "lexical")]);
    expect(first).toMatchObject({ id: "a", resolution: "fix a", resolvedBy: "dana", similarity: 0.77, matchedBy: "lexical" });
  });
});
