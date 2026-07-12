import { describe, expect, test } from "vitest";
import { isAuthorizedUser, isIssueRepoAllowed } from "./config.js";
import type { AppConfig } from "./config.js";

function cfg(over: Partial<AppConfig>): AppConfig {
  return over as AppConfig;
}

describe("isIssueRepoAllowed", () => {
  test("permits the default repo and rejects others", () => {
    const c = cfg({ GITHUB_DEFAULT_REPO: "acme/store" });
    expect(isIssueRepoAllowed(c, "acme/store")).toBe(true);
    expect(isIssueRepoAllowed(c, "ACME/Store")).toBe(true); // case-insensitive
    expect(isIssueRepoAllowed(c, "evil/repo")).toBe(false);
  });

  test("permits repos in the allowlist", () => {
    const c = cfg({ GITHUB_DEFAULT_REPO: "acme/store", GITHUB_ALLOWED_REPOS: "acme/infra, acme/web" });
    expect(isIssueRepoAllowed(c, "acme/infra")).toBe(true);
    expect(isIssueRepoAllowed(c, "acme/web")).toBe(true);
    expect(isIssueRepoAllowed(c, "acme/other")).toBe(false);
  });

  test("is unrestricted only when nothing is configured", () => {
    expect(isIssueRepoAllowed(cfg({}), "anyone/anything")).toBe(true);
  });
});

describe("isAuthorizedUser", () => {
  test("everyone is authorized when no allowlist is set (demo default)", () => {
    expect(isAuthorizedUser(cfg({}), "U1")).toBe(true);
    expect(isAuthorizedUser(cfg({ AUTHORIZED_USERS: "  " }), undefined)).toBe(true);
  });

  test("with an allowlist, only listed users pass — unknown users and missing ids fail", () => {
    const c = cfg({ AUTHORIZED_USERS: "U0AAA, U0BBB" });
    expect(isAuthorizedUser(c, "U0AAA")).toBe(true);
    expect(isAuthorizedUser(c, "U0BBB")).toBe(true);
    expect(isAuthorizedUser(c, "U0EVIL")).toBe(false);
    expect(isAuthorizedUser(c, undefined)).toBe(false);
  });
});
