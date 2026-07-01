import { describe, expect, test } from "vitest";
import { buildIncidentCanvasMarkdown, buildResolutionCanvasMarkdown, mdSafe, safeHttpUrl } from "./canvas.js";
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

  test("includes a title, status, and categorical confidence", () => {
    expect(md).toContain("# Incident: Checkout returns 500 after payment refactor");
    expect(md).toContain("**Status:** Investigating");
    expect(md).toContain("**Confidence:** High"); // 91 → High, no percentage
    expect(md).not.toContain("91%");
  });

  test("includes the prior-incident and evidence sections", () => {
    expect(md).toContain("## Prior incidents");
    expect(md).toContain("**Strong match**");
    expect(md).toContain("Resolved by dana");
    expect(md).toContain("[Refactor payment client #1](https://x/pr/1)");
  });

  test("renders recommended actions as checkboxes", () => {
    expect(md).toContain("- [ ] Set PAYMENTS_API_KEY in prod");
  });
});

describe("mdSafe", () => {
  test("neutralises link and emphasis markers and collapses newlines", () => {
    const evil = mdSafe("[click](http://evil.com)\n*bold* `code`");
    expect(evil).not.toContain("[click](http://evil.com)");
    expect(evil).not.toMatch(/\n/);
    expect(evil).toContain("\\[click\\]");
    expect(evil).toContain("\\*bold\\*");
    expect(evil).toContain("\\`code\\`");
  });

  test("leaves intraword underscores and hashes readable (rendered fine, not line-leading)", () => {
    expect(mdSafe("PAYMENTS_API_KEY #1")).toBe("PAYMENTS_API_KEY #1");
  });
});

describe("safeHttpUrl", () => {
  test("accepts http(s) and rejects other schemes / junk", () => {
    expect(safeHttpUrl("https://github.com/o/r/pull/1")).toBe("https://github.com/o/r/pull/1");
    expect(safeHttpUrl("javascript:alert(1)")).toBeNull();
    expect(safeHttpUrl("not a url")).toBeNull();
    expect(safeHttpUrl(null)).toBeNull();
  });
});

describe("canvas markdown escapes untrusted incident text", () => {
  test("a report with markdown can't inject links or a fake resolution section", () => {
    const md = buildIncidentCanvasMarkdown(
      { ...result, summary: "[pwn](http://evil.com)" },
      "acme/store",
      "## Resolution by me",
      "nabeel",
    );
    expect(md).not.toContain("[pwn](http://evil.com)");
    // the injected heading must be neutralised, not a real "## Resolution" line
    expect(md).not.toMatch(/\n## Resolution by me/);
  });
});

describe("buildResolutionCanvasMarkdown", () => {
  const base: IncidentRecord = {
    id: "inc-1", symptom: "x", rootCause: "y", resolution: "restored the env var", resolvedBy: "dana",
    links: [], repo: null, createdAt: "", hypothesisWasCorrect: true, embedding: null,
  };

  test("shows the fix, who, and a correct-hypothesis outcome", () => {
    const md = buildResolutionCanvasMarkdown(base);
    expect(md).toContain("## Resolution");
    expect(md).toContain("**What fixed it:** restored the env var");
    expect(md).toContain("**Resolved by:** dana");
    expect(md).toContain("**Hypothesis was:** correct");
  });

  test("reflects a wrong or partial hypothesis", () => {
    expect(buildResolutionCanvasMarkdown({ ...base, hypothesisWasCorrect: false })).toContain("**Hypothesis was:** incorrect");
    expect(buildResolutionCanvasMarkdown({ ...base, hypothesisWasCorrect: null })).toContain("**Hypothesis was:** partially correct");
  });
});
