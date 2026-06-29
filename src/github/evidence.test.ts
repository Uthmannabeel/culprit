import { afterEach, describe, expect, test, vi } from "vitest";
import type { AppConfig } from "../config.js";
import { listRecentPullRequests, listOpenIssues, searchCode } from "./evidence.js";

const config = { GITHUB_TOKEN: "test-token" } as AppConfig;

/** Stub global fetch to return a given JSON body with status 200. */
function mockFetchJson(body: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, status: 200, json: async () => body, text: async () => "" }) as unknown as Response),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("listRecentPullRequests", () => {
  test("derives the merged flag from merged_at and maps author/url", async () => {
    mockFetchJson([
      {
        number: 1,
        title: "Refactor payment client",
        state: "closed",
        merged_at: "2026-06-20T10:00:00Z",
        html_url: "https://github.com/o/r/pull/1",
        user: { login: "octocat" },
      },
      { number: 2, title: "WIP", state: "closed", merged_at: null, html_url: "https://github.com/o/r/pull/2", user: null },
    ]);

    const prs = await listRecentPullRequests(config, "o/r");

    expect(prs[0]).toMatchObject({ number: 1, merged: true, author: "octocat" });
    expect(prs[1]).toMatchObject({ merged: false, author: "unknown" });
  });
});

describe("listOpenIssues", () => {
  test("filters out pull requests and normalizes labels", async () => {
    mockFetchJson([
      {
        number: 10,
        title: "Checkout 500s",
        html_url: "https://github.com/o/r/issues/10",
        created_at: "2026-06-25T00:00:00Z",
        user: { login: "reporter" },
        labels: [{ name: "bug" }, "sev1"],
      },
      {
        number: 11,
        title: "A PR masquerading as an issue",
        html_url: "https://github.com/o/r/pull/11",
        created_at: "2026-06-26T00:00:00Z",
        pull_request: { url: "..." },
        user: { login: "dev" },
        labels: [],
      },
    ]);

    const issues = await listOpenIssues(config, "o/r");

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ number: 10, author: "reporter", labels: ["bug", "sev1"] });
  });
});

describe("searchCode", () => {
  test("maps the search items to path/url pairs", async () => {
    mockFetchJson({ items: [{ path: "src/checkout.js", html_url: "https://github.com/o/r/blob/main/src/checkout.js" }] });

    const matches = await searchCode(config, "o/r", "checkout");

    expect(matches).toEqual([{ path: "src/checkout.js", url: "https://github.com/o/r/blob/main/src/checkout.js" }]);
  });

  test("returns an empty array when there are no items", async () => {
    mockFetchJson({});
    expect(await searchCode(config, "o/r", "nothing")).toEqual([]);
  });
});
