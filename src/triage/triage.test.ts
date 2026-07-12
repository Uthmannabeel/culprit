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

  test("accepts an evidence item with NO url key — Gemini omits non-required fields", () => {
    // Regression: Gemini's tool schema marks url optional; a missing key used to
    // throw AFTER a successful investigation, losing the whole verdict.
    const verdict = {
      ...sample,
      evidence: [{ kind: "other", title: "no recent deploys found", why: "checked deployments" }],
    };
    const parsed = TriageResultSchema.parse(verdict);
    expect(parsed.evidence[0]?.url).toBeNull();
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
          { id: "inc-1", symptom: "checkout 500s after deploy", resolution: "restored env var", resolvedBy: "dana", similarity: 0.77, url: "https://x/pr/1", repo: "acme/store" },
        ],
      },
      "o/r",
    );
    const text = JSON.stringify(withPrior);
    expect(text).toContain("Prior incident match");
    expect(text).toContain("Strong match");
    expect(text).toContain("dana");
    expect(text).toContain("acme/store"); // cross-repo precedent is labeled with its origin
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
          { id: "p1", symptom: "symptom ".repeat(100), resolution: "fix ".repeat(200), resolvedBy: "dana", similarity: 0.9, url: "https://x/1", repo: null },
          { id: "p2", symptom: "symptom ".repeat(100), resolution: "fix ".repeat(200), resolvedBy: "sam", similarity: 0.8, url: "https://x/2", repo: null },
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
        evidence: [{ kind: "commit", title: "fix: a | b | c", url: "https://github.com/o/r/commit/1", why: "contains pipes" }],
      },
      "o/r",
    );
    const text = JSON.stringify(withPipe);
    expect(text).toContain("fix: a / b / c"); // pipes neutralised in the link label
  });

  test("GitHub-kind evidence pointing off-GitHub renders unlinked (spoof guard)", () => {
    const spoofed = renderTriageBlocks(
      {
        ...sample,
        evidence: [{ kind: "commit", title: "commit abc123 in o/r", url: "https://evil.example/phish", why: "spoofed" }],
      },
      "o/r",
    );
    const text = JSON.stringify(spoofed);
    expect(text).not.toContain("evil.example");
    expect(text).toContain("commit abc123 in o/r");
  });

  test("previews the draft-issue body so the human sees what the button files", () => {
    const text = JSON.stringify(renderTriageBlocks(sample, "o/r"));
    expect(text).toContain("## Summary"); // first lines of the body are visible
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

  test("the resolve button survives quote-dense reports and long URLs (JSON escaping doubles them)", () => {
    // Regression: the resolve button was raw JSON.stringify — a pasted JSON log
    // (quotes + backslashes) plus a long evidence URL could blow the 2000 cap
    // and reject the ENTIRE card after a successful triage.
    const nasty = renderTriageBlocks(
      {
        ...sample,
        rootCauseHypothesis: '{"error":"payment \\"key\\" missing","path":"C:\\\\prod\\\\config"} '.repeat(20),
        evidence: [
          { kind: "commit", title: "c", url: `https://github.com/o/r/commit/${"a".repeat(40)}?trace=${"y".repeat(900)}`, why: "w" },
        ],
      },
      "o/r",
      '{"log":"checkout \\"500\\" at C:\\\\srv\\\\app"} '.repeat(10),
    );
    const actions = nasty.find((b) => b.type === "actions") as { elements: { value?: string }[] };
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
