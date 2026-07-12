import { beforeEach, describe, expect, test } from "vitest";
import {
  alreadyFiledUrl,
  clearDraftStore,
  decodeIssuePayload,
  decodeResolveContext,
  encodeIssuePayload,
  encodeResolveContext,
  markDuplicateWarned,
  markFiled,
  wasDuplicateWarned,
} from "./draftStore.js";
import type { ResolveContext } from "./resolve.js";

const smallIssue = { title: "Checkout 500s", body: "short body", labels: ["bug"] };

beforeEach(() => clearDraftStore());

describe("encodeIssuePayload / decodeIssuePayload", () => {
  test("small payloads are inlined (restart-durable) and round-trip", () => {
    const value = encodeIssuePayload({ repo: "acme/store", issue: smallIssue });
    expect(value).toContain("Checkout 500s"); // inline, not an id
    expect(decodeIssuePayload(value)).toEqual({ repo: "acme/store", issue: smallIssue });
  });

  test("oversized payloads stay under Slack's 2000-char button limit", () => {
    const bigIssue = { ...smallIssue, body: "x".repeat(5000) };
    const value = encodeIssuePayload({ repo: "acme/store", issue: bigIssue });
    expect(value.length).toBeLessThanOrEqual(2000);
    // ...and still round-trip through the store with the full body intact.
    expect(decodeIssuePayload(value)?.issue.body).toHaveLength(5000);
  });

  test("an unknown draft id decodes to null (e.g. after a restart)", () => {
    const bigIssue = { ...smallIssue, body: "x".repeat(5000) };
    const value = encodeIssuePayload({ repo: "acme/store", issue: bigIssue });
    clearDraftStore(); // simulate restart
    expect(decodeIssuePayload(value)).toBeNull();
  });

  test("malformed or empty values decode to null", () => {
    expect(decodeIssuePayload(undefined)).toBeNull();
    expect(decodeIssuePayload("not json")).toBeNull();
    expect(decodeIssuePayload(JSON.stringify({ nonsense: true }))).toBeNull();
  });
});

describe("encodeResolveContext / decodeResolveContext", () => {
  const ctx: ResolveContext = {
    symptom: "checkout 500s",
    hypothesis: "env var renamed",
    repo: "acme/store",
    suspectedOwner: "dana",
    link: "https://github.com/acme/store/pull/1",
    channel: null,
    threadTs: null,
    canvasId: null,
  };

  test("small contexts inline and round-trip", () => {
    const value = encodeResolveContext(ctx);
    expect(value.length).toBeLessThanOrEqual(2000);
    expect(decodeResolveContext(value)).toEqual(ctx);
  });

  test("oversized contexts spill to the store but stay under the button cap", () => {
    const big = { ...ctx, hypothesis: '"quote-dense" \\path\\ '.repeat(100) };
    const value = encodeResolveContext(big);
    expect(value.length).toBeLessThanOrEqual(2000);
    expect(decodeResolveContext(value)?.hypothesis).toBe(big.hypothesis);
  });

  test("a spilled context dies with a restart → null, so the handler can explain", () => {
    const big = { ...ctx, hypothesis: "x".repeat(3000) };
    const value = encodeResolveContext(big);
    clearDraftStore();
    expect(decodeResolveContext(value)).toBeNull();
  });

  test("malformed values decode to null", () => {
    expect(decodeResolveContext(undefined)).toBeNull();
    expect(decodeResolveContext("not json")).toBeNull();
    expect(decodeResolveContext(JSON.stringify({ nonsense: true }))).toBeNull();
  });
});

describe("filed-issue idempotency", () => {
  test("a value is unfiled until marked, then returns the issue URL", () => {
    const value = encodeIssuePayload({ repo: "acme/store", issue: smallIssue });
    expect(alreadyFiledUrl(value)).toBeNull();
    markFiled(value, "https://github.com/acme/store/issues/7");
    expect(alreadyFiledUrl(value)).toBe("https://github.com/acme/store/issues/7");
  });

  test("undefined values are ignored", () => {
    markFiled(undefined, "https://x");
    expect(alreadyFiledUrl(undefined)).toBeNull();
  });

  test("duplicate warnings are tracked per card value", () => {
    const value = encodeIssuePayload({ repo: "acme/store", issue: smallIssue });
    expect(wasDuplicateWarned(value)).toBe(false);
    markDuplicateWarned(value);
    expect(wasDuplicateWarned(value)).toBe(true);
    expect(wasDuplicateWarned(undefined)).toBe(false);
  });
});
