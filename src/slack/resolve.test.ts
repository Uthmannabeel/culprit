import { describe, expect, test } from "vitest";
import {
  buildResolveModal,
  buildResolvedIncident,
  parseResolveSubmission,
  VIEW_MARK_RESOLVED,
  type ResolveContext,
} from "./resolve.js";

const ctx: ResolveContext = {
  symptom: "checkout is throwing 500s",
  hypothesis: "PR renamed the payment key env var",
  repo: "acme/store",
  suspectedOwner: "octocat",
  link: "https://github.com/acme/store/pull/1",
  channel: "C1",
  threadTs: "1700.1",
  canvasId: null,
};

describe("buildResolveModal", () => {
  test("carries the context in private_metadata and targets the submit view", () => {
    const view = buildResolveModal(ctx);
    expect(view.callback_id).toBe(VIEW_MARK_RESOLVED);
    expect(JSON.parse(view.private_metadata!)).toMatchObject({ repo: "acme/store", channel: "C1" });
  });
});

describe("parseResolveSubmission", () => {
  test("maps yes/no/partly to a tri-state and trims text", () => {
    const yes = parseResolveSubmission({
      fix: { value: { value: "  re-added the env var  " } },
      hyp: { value: { selected_option: { value: "yes" } } },
      who: { value: { value: "dana" } },
    } as never);
    expect(yes).toEqual({ resolution: "re-added the env var", hypothesisWasCorrect: true, resolvedBy: "dana" });

    const partly = parseResolveSubmission({ hyp: { value: { selected_option: { value: "partly" } } } } as never);
    expect(partly.hypothesisWasCorrect).toBeNull();

    const no = parseResolveSubmission({ hyp: { value: { selected_option: { value: "no" } } } } as never);
    expect(no.hypothesisWasCorrect).toBe(false);
  });

  test("treats empty resolver as null", () => {
    const f = parseResolveSubmission({ who: { value: { value: "   " } } } as never);
    expect(f.resolvedBy).toBeNull();
  });
});

describe("buildResolvedIncident", () => {
  test("composes a memory record from context + answers", () => {
    const record = buildResolvedIncident(
      ctx,
      { resolution: "restored PAYMENTS_API_KEY in prod", hypothesisWasCorrect: true, resolvedBy: "dana" },
      "inc-1700.1",
      "2026-06-30T00:00:00Z",
    );
    expect(record).toMatchObject({
      id: "inc-1700.1",
      symptom: ctx.symptom,
      rootCause: ctx.hypothesis,
      resolution: "restored PAYMENTS_API_KEY in prod",
      resolvedBy: "dana",
      links: ["https://github.com/acme/store/pull/1"],
      repo: "acme/store",
      hypothesisWasCorrect: true,
    });
  });

  test("falls back to the suspected owner when no resolver is given", () => {
    const record = buildResolvedIncident(ctx, { resolution: "x", hypothesisWasCorrect: null, resolvedBy: null }, "id", "t");
    expect(record.resolvedBy).toBe("octocat");
  });
});
