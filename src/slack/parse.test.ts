import { describe, expect, test, vi } from "vitest";
import {
  collectThreadTail,
  formatThreadContext,
  parseAlertChannels,
  parseMemoryCommand,
  parseRepo,
  shouldAutoTriage,
  stripMentions,
  type ThreadPage,
} from "./parse.js";

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

  test("strips sentence-final punctuation — 'repo:acme/store.' must not 404 everything", () => {
    expect(parseRepo("investigate repo:acme/store.")).toBe("acme/store");
    expect(parseRepo("repo:acme/api, checkout is down")).toBe("acme/api");
    expect(parseRepo("(see https://github.com/acme/store)")).toBe("acme/store");
  });

  test("rejects candidates outside GitHub's owner/repo charset instead of injecting them", () => {
    expect(parseRepo("repo:acme?x=1/store", "fall/back")).toBe("fall/back");
    expect(parseRepo("repo:acme/store%2e", "fall/back")).toBe("fall/back");
  });
});

describe("stripMentions", () => {
  test("removes bot mentions and trims", () => {
    expect(stripMentions("<@U123ABC> checkout is 500ing")).toBe("checkout is 500ing");
    expect(stripMentions("<@U123ABC>")).toBe("");
  });
});

describe("formatThreadContext", () => {
  test("keeps prior discussion, excludes the trigger, strips mentions", () => {
    const out = formatThreadContext(
      [
        { text: "checkout errors spiking since 09:40", ts: "1.0" },
        { text: "<@U1> tried restarting the pods, no change", ts: "2.0" },
        { text: "<@UBOT> what's the cause?", ts: "3.0" }, // trigger
      ],
      "3.0",
    );
    expect(out).toContain("checkout errors spiking since 09:40");
    expect(out).toContain("tried restarting the pods");
    expect(out).not.toContain("what's the cause");
    expect(out).not.toContain("<@U1>");
  });

  test("caps total size and message count", () => {
    const messages = Array.from({ length: 30 }, (_, i) => ({ text: `msg ${i} ${"x".repeat(280)}`, ts: `${i}` }));
    const out = formatThreadContext(messages, "none");
    expect(out.length).toBeLessThanOrEqual(2500 + 200);
    expect(out.split("\n").length).toBeLessThanOrEqual(12);
  });

  test("returns empty for no usable messages", () => {
    expect(formatThreadContext([{ text: "", ts: "1" }], "1")).toBe("");
  });

  test("when the budget runs out, the NEWEST messages survive (they hold the freshest clues)", () => {
    const messages = Array.from({ length: 30 }, (_, i) => ({ text: `msg-${i} ${"x".repeat(280)}`, ts: `${i}` }));
    const out = formatThreadContext(messages, "none");
    expect(out).toContain("msg-29"); // newest kept
    expect(out).not.toContain("msg-0 "); // oldest dropped
    // and chronological order is preserved for the survivors
    const first = out.indexOf("msg-2");
    const last = out.indexOf("msg-29");
    expect(first).toBeLessThan(last);
  });
});

describe("collectThreadTail", () => {
  /** A thread of `total` messages served in pages of `pageSize`, oldest-first like Slack. */
  function pagedThread(total: number, pageSize: number) {
    const all = Array.from({ length: total }, (_, i) => ({ text: `msg-${i}`, ts: `${i}` }));
    return vi.fn(async (cursor?: string): Promise<ThreadPage> => {
      const start = cursor ? Number(cursor) : 0;
      const messages = all.slice(start, start + pageSize);
      const next = start + pageSize < total ? String(start + pageSize) : undefined;
      return { messages, ...(next ? { nextCursor: next } : {}) };
    });
  }

  test("a short thread needs one page and returns everything", async () => {
    const fetchPage = pagedThread(10, 200);
    const tail = await collectThreadTail(fetchPage, 50);
    expect(tail).toHaveLength(10);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  test("a long thread is walked to the END — the tail holds the NEWEST messages", async () => {
    // Regression: replies arrive oldest-first, so fetching one page of a
    // 450-reply thread used to yield msg-0..99 and drop everything near the
    // @mention. The walk must surface msg-449, not msg-0.
    const fetchPage = pagedThread(450, 200);
    const tail = await collectThreadTail(fetchPage, 50);
    expect(fetchPage).toHaveBeenCalledTimes(3); // 200 + 200 + 50
    expect(tail).toHaveLength(50);
    expect(tail[0]?.text).toBe("msg-400");
    expect(tail[tail.length - 1]?.text).toBe("msg-449");
  });

  test("a pathological thread stops at the page cap instead of walking forever", async () => {
    const fetchPage = pagedThread(10_000, 200);
    const tail = await collectThreadTail(fetchPage, 50, 5);
    expect(fetchPage).toHaveBeenCalledTimes(5);
    expect(tail).toHaveLength(50); // best-effort window, bounded work
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

  test("with ALERT_BOT_IDS set, only those bots trigger — humans and strangers don't", () => {
    const allowed = new Set(["B0SENTRY"]);
    expect(shouldAutoTriage({ ...base, bot_id: "B0SENTRY" }, alerts, "B0SELF", allowed)).toBe(true);
    expect(shouldAutoTriage({ ...base, bot_id: "B0STRANGER" }, alerts, "B0SELF", allowed)).toBe(false);
    expect(shouldAutoTriage(base, alerts, "B0SELF", allowed)).toBe(false); // human post
    // empty allowlist = old behaviour
    expect(shouldAutoTriage(base, alerts, "B0SELF", new Set())).toBe(true);
  });
});
