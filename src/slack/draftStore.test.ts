import { beforeEach, describe, expect, test } from "vitest";
import { alreadyFiledUrl, clearDraftStore, decodeIssuePayload, encodeIssuePayload, markFiled } from "./draftStore.js";

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
});
