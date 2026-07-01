import { describe, expect, test } from "vitest";
import { TriageResultSchema, type TriageResult } from "./types.js";
import { renderTriageBlocks, ACTION_CREATE_ISSUE } from "../slack/blocks.js";

const sample: TriageResult = {
  summary: "Checkout returns 500 after the recent payment refactor",
  rootCauseHypothesis: "PR #482 changed the Stripe client init and dropped the API key env var.",
  confidence: 72,
  severity: "sev1",
  suspectedOwner: "octocat",
  evidence: [
    { kind: "pull_request", title: "Refactor payment client #482", url: "https://github.com/o/r/pull/482", why: "Touched checkout init" },
    { kind: "commit", title: "remove legacy key loader", url: null, why: "Removed env var read" },
  ],
  priorIncidents: [],
  recommendedActions: ["Roll back PR #482", "Verify STRIPE_API_KEY is set in prod"],
  draftIssue: { title: "Checkout 500s after payment refactor", body: "## Summary\n...", labels: ["bug", "sev1"] },
};

describe("TriageResultSchema", () => {
  test("accepts a well-formed verdict", () => {
    expect(() => TriageResultSchema.parse(sample)).not.toThrow();
  });

  test("rejects confidence outside 0-100", () => {
    expect(() => TriageResultSchema.parse({ ...sample, confidence: 140 })).toThrow();
  });

  test("rejects an unknown severity", () => {
    expect(() => TriageResultSchema.parse({ ...sample, severity: "catastrophic" })).toThrow();
  });
});

describe("renderTriageBlocks", () => {
  const blocks = renderTriageBlocks(sample, "o/r");

  test("starts with a header block", () => {
    expect(blocks[0]?.type).toBe("header");
  });

  test("includes a create-issue action carrying the draft", () => {
    const actions = blocks.find((b) => b.type === "actions") as
      | { elements: { action_id: string; value: string }[] }
      | undefined;
    const button = actions?.elements.find((e) => e.action_id === ACTION_CREATE_ISSUE);
    expect(button).toBeDefined();
    const payload = JSON.parse(button!.value) as { repo: string; issue: { title: string } };
    expect(payload.repo).toBe("o/r");
    expect(payload.issue.title).toBe(sample.draftIssue.title);
  });

  test("renders a prior-incident panel with categorical similarity (no percentages)", () => {
    const withPrior = renderTriageBlocks(
      {
        ...sample,
        priorIncidents: [
          { id: "inc-1", symptom: "checkout 500s after deploy", resolution: "restored env var", resolvedBy: "dana", similarity: 0.77, url: "https://x/pr/1" },
        ],
      },
      "o/r",
    );
    const text = JSON.stringify(withPrior);
    expect(text).toContain("Prior incident match");
    expect(text).toContain("Strong match");
    expect(text).toContain("dana");
    expect(text).not.toContain("77%"); // categorical words, not fake precision
  });

  test("omits the prior-incident panel when there are none", () => {
    const text = JSON.stringify(renderTriageBlocks(sample, "o/r"));
    expect(text).not.toContain("Prior incident match");
  });

  test("expresses confidence as a word, never a bar or percentage", () => {
    const text = JSON.stringify(renderTriageBlocks(sample, "o/r"));
    expect(text).toContain("*Confidence:*\\nMedium"); // sample.confidence = 72
    expect(text).not.toContain("█");
    expect(text).not.toContain("72%");
  });

  test("keeps every section text under Slack's 3000-char limit even for huge verdicts", () => {
    const huge = renderTriageBlocks(
      {
        ...sample,
        rootCauseHypothesis: "very long cause ".repeat(400),
        evidence: Array.from({ length: 6 }, (_, i) => ({
          kind: "commit" as const,
          title: `commit ${i} — ${"long title ".repeat(30)}`,
          url: `https://github.com/o/r/commit/${"a".repeat(40)}?q=${"x".repeat(200)}`,
          why: "reason ".repeat(60),
        })),
        priorIncidents: [
          { id: "p1", symptom: "symptom ".repeat(100), resolution: "fix ".repeat(200), resolvedBy: "dana", similarity: 0.9, url: "https://x/1" },
          { id: "p2", symptom: "symptom ".repeat(100), resolution: "fix ".repeat(200), resolvedBy: "sam", similarity: 0.8, url: "https://x/2" },
        ],
      },
      "o/r",
    );
    for (const b of huge) {
      if (b.type === "section" && "text" in b && b.text) {
        expect((b.text as { text: string }).text.length).toBeLessThanOrEqual(3000);
      }
    }
  });

  test("pipes in evidence titles can't corrupt mrkdwn links", () => {
    const withPipe = renderTriageBlocks(
      {
        ...sample,
        evidence: [{ kind: "commit", title: "fix: a | b | c", url: "https://x/commit/1", why: "contains pipes" }],
      },
      "o/r",
    );
    const text = JSON.stringify(withPipe);
    expect(text).toContain("fix: a / b / c"); // pipes neutralised in the link label
  });

  test("keeps every button value under Slack's 2000-char limit even for huge drafts", () => {
    const huge = renderTriageBlocks(
      { ...sample, draftIssue: { ...sample.draftIssue, body: "detail ".repeat(1000) } },
      "o/r",
    );
    const actions = huge.find((b) => b.type === "actions") as { elements: { value?: string }[] };
    for (const el of actions.elements) {
      expect((el.value ?? "").length).toBeLessThanOrEqual(2000);
    }
  });

  test("escapes angle brackets in untrusted mrkdwn text", () => {
    const evil = renderTriageBlocks(
      { ...sample, rootCauseHypothesis: "<script>alert(1)</script> in checkout" },
      "o/r",
    );
    const cause = evil.find(
      (b) => b.type === "section" && "text" in b && (b as { text: { text: string } }).text.text.includes("Likely root cause"),
    ) as { text: { text: string } };
    expect(cause.text.text).not.toContain("<script>");
    expect(cause.text.text).toContain("&lt;script&gt;");
  });
});
