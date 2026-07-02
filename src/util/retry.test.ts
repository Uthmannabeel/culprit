import { describe, expect, test, vi } from "vitest";
import { isTransient, withRetry } from "./retry.js";

describe("isTransient", () => {
  test("rate limits, overload, and network failures are transient", () => {
    expect(isTransient(new Error('{"code":429,"status":"RESOURCE_EXHAUSTED"}'))).toBe(true);
    expect(isTransient(new Error("fetch failed"))).toBe(true);
    expect(isTransient(new Error("read ECONNRESET"))).toBe(true);
  });

  test("auth and validation failures are not", () => {
    expect(isTransient(new Error("PERMISSION_DENIED: bad key"))).toBe(false);
    expect(isTransient(new Error("invalid schema"))).toBe(false);
  });
});

describe("withRetry", () => {
  test("retries transient failures and returns the eventual success", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("fetch failed"))
      .mockResolvedValueOnce("ok");
    await expect(withRetry(fn, { baseDelayMs: 1 })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  test("does not retry non-transient failures", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("PERMISSION_DENIED"));
    await expect(withRetry(fn, { baseDelayMs: 1 })).rejects.toThrow("PERMISSION_DENIED");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test("gives up after the attempt budget", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("fetch failed"));
    await expect(withRetry(fn, { attempts: 3, baseDelayMs: 1 })).rejects.toThrow("fetch failed");
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
