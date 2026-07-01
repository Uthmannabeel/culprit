import { describe, expect, test } from "vitest";
import { buildIncidentCanvasMarkdown, buildResolutionCanvasMarkdown } from "./canvas.js";
import type { TriageResult } from "../triage/types.js";
import type { IncidentRecord } from "../memory/types.js";

const result: TriageResult = {
  summary: "Checkout returns 500 after payment refactor",
  rootCauseHypothesis: "PR #1 renamed the payment key env var; prod still sets the old name.",
  confidence: 91,
  severity: "sev1",
  suspectedOwner: "octocat",
  evidence: [{ kind: "pull_request", title: "Refactor payment client #1", url: "https://x/pr/1", why: "renamed the key" }],
  priorIncidents: [
    { id: "inc-1", symptom: "payments failing at checkout", resolution: "restored env var", resolvedBy: "dana", similarity: 0.77, url: "https://x/pr/1" },
  ],
  recommendedActions: ["Set PAYMENTS_API_KEY in prod"],
  draftIssue: { title: "Checkout 500s", body: "...", labels: ["bug"] },
};

describe("buildIncidentCanvasMarkdown", () => {
  const md = buildIncidentCanvasMarkdown(result, "acme/store", "checkout is 500ing", "nabeel");

  test("includes a title, status, and confidence", () => {
    expect(md).toContain("# 🔍 Incident: Checkout returns 500 after payment refactor");
    expect(md).toContain("**Status:** 🟠 Investigating");
    expect(md).toContain("91% confidence");
  });

  test("includes the prior-incident and evidence sections", () => {
    expect(md).toContain("🧠 We've seen this before");
    expect(md).toContain("77% match");
    expect(md).toContain("fixed by dana");
    expect(md).toContain("[Refactor payment client #1](https://x/pr/1)");
  });

  test("renders recommended actions as checkboxes", () => {
    expect(md).toContain("- [ ] Set PAYMENTS_API_KEY in prod");
  });
});

describe("buildResolutionCanvasMarkdown", () => {
  const base: IncidentRecord = {
    id: "inc-1", symptom: "x", rootCause: "y", resolution: "restored the env var", resolvedBy: "dana",
    links: [], repo: null, createdAt: "", hypothesisWasCorrect: true, embedding: null,
  };

  test("shows the fix, who, and a correct-hypothesis outcome", () => {
    const md = buildResolutionCanvasMarkdown(base);
    expect(md).toContain("## ✅ Resolved");
    expect(md).toContain("**What fixed it:** restored the env var");
    expect(md).toContain("**Fixed by:** dana");
    expect(md).toContain("✅ hypothesis was correct");
  });

  test("reflects a wrong or partial hypothesis", () => {
    expect(buildResolutionCanvasMarkdown({ ...base, hypothesisWasCorrect: false })).toContain("❌ hypothesis was wrong");
    expect(buildResolutionCanvasMarkdown({ ...base, hypothesisWasCorrect: null })).toContain("➖ hypothesis was partly right");
  });
});
