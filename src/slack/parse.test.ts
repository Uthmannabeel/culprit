import { describe, expect, test } from "vitest";
import { parseAlertChannels, parseMemoryCommand, parseRepo, shouldAutoTriage, stripMentions } from "./parse.js";

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

describe("parseMemoryCommand", () => {
  test("recognises memory/stats and forget commands", () => {
    expect(parseMemoryCommand("memory")).toEqual({ type: "stats" });
    expect(parseMemoryCommand(" Stats ")).toEqual({ type: "stats" });
    expect(parseMemoryCommand("forget inc-2026-04-12")).toEqual({ type: "forget", id: "inc-2026-04-12" });
  });

  test("normal incident reports are not commands", () => {
    expect(parseMemoryCommand("checkout is throwing 500s")).toBeNull();
    expect(parseMemoryCommand("please forget about it and triage")).toBeNull();
  });
});

describe("shouldAutoTriage", () => {
  const alerts = parseAlertChannels("C0ALERTS, C0OTHER");
  const base = { channel: "C0ALERTS", channel_type: "channel", text: "Error rate spike on checkout" };

  test("triggers on a top-level message in a watched channel", () => {
    expect(shouldAutoTriage(base, alerts, "B0SELF")).toBe(true);
    expect(shouldAutoTriage({ ...base, bot_id: "B0SENTRY" }, alerts, "B0SELF")).toBe(true); // webhook bots OK
  });

  test("never triggers outside watched channels, in threads, or on its own posts", () => {
    expect(shouldAutoTriage({ ...base, channel: "C0RANDOM" }, alerts, "B0SELF")).toBe(false);
    expect(shouldAutoTriage({ ...base, thread_ts: "1.2" }, alerts, "B0SELF")).toBe(false);
    expect(shouldAutoTriage({ ...base, bot_id: "B0SELF" }, alerts, "B0SELF")).toBe(false);
    expect(shouldAutoTriage({ ...base, text: "  " }, alerts, "B0SELF")).toBe(false);
    expect(shouldAutoTriage(base, parseAlertChannels(undefined), "B0SELF")).toBe(false);
  });
});
