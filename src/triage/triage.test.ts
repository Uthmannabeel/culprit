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

  test("renders a 'seen before' panel when prior incidents exist", () => {
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
    expect(text).toContain("seen this before");
    expect(text).toContain("77% match");
    expect(text).toContain("dana");
  });

  test("omits the 'seen before' panel when there are no prior incidents", () => {
    const text = JSON.stringify(renderTriageBlocks(sample, "o/r"));
    expect(text).not.toContain("seen this before");
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

  test("escapes angle brackets in untrusted text", () => {
    const evil = renderTriageBlocks({ ...sample, summary: "<script>alert(1)</script>" }, "o/r");
    const section = evil[1] as { text: { text: string } };
    expect(section.text.text).not.toContain("<script>");
    expect(section.text.text).toContain("&lt;script&gt;");
  });
});
