import { describe, expect, test } from "vitest";
import { parseRepo, stripMentions } from "./parse.js";

describe("parseRepo", () => {
  test("reads an explicit repo: tag", () => {
    expect(parseRepo("checkout is down repo:acme/store")).toBe("acme/store");
  });

  test("reads a plain GitHub URL", () => {
    expect(parseRepo("see https://github.com/acme/store please")).toBe("acme/store");
  });

  test("handles Slack-linkified URLs (angle brackets)", () => {
    // Slack delivers URLs as <url> — the trailing '>' must not join the repo name.
    expect(parseRepo("broken after <https://github.com/acme/store>")).toBe("acme/store");
  });

  test("handles Slack links with labels (<url|label>)", () => {
    expect(parseRepo("<https://github.com/acme/store|our repo> is down")).toBe("acme/store");
  });

  test("repo: tag wrapped by Slack autolink keeps only owner/name", () => {
    expect(parseRepo("repo:acme/store> something")).toBe("acme/store");
  });

  test("falls back to the default, or undefined", () => {
    expect(parseRepo("no repo here", "fall/back")).toBe("fall/back");
    expect(parseRepo("no repo here")).toBeUndefined();
  });
});

describe("stripMentions", () => {
  test("removes bot mentions and trims", () => {
    expect(stripMentions("<@U123ABC> checkout is 500ing")).toBe("checkout is 500ing");
    expect(stripMentions("<@U123ABC>")).toBe("");
  });
});
