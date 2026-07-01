import { describe, expect, test } from "vitest";
import { describeToolCall, friendlyTriageError } from "./progress.js";

describe("describeToolCall", () => {
  test("narrates known tools and humanises unknown ones", () => {
    expect(describeToolCall("list_recent_pull_requests")).toBe("Reviewing recently merged pull requests");
    expect(describeToolCall("list_recent_deployments")).toBe("Checking recent deployments");
    expect(describeToolCall("some_mcp_tool")).toBe("Checking GitHub (some mcp tool)");
    expect(describeToolCall(undefined)).toBe("Gathering evidence");
  });
});

describe("friendlyTriageError", () => {
  test("names rate limits so responders don't debug the wrong thing", () => {
    const msg = friendlyTriageError(new Error('{"error":{"code":429,"status":"RESOURCE_EXHAUSTED"}}'));
    expect(msg).toContain("rate limit");
  });

  test("names key problems", () => {
    expect(friendlyTriageError(new Error("PERMISSION_DENIED: API key not valid"))).toContain("API key");
  });

  test("falls back to generic guidance", () => {
    expect(friendlyTriageError(new Error("something odd"))).toContain("Try again");
  });
});
