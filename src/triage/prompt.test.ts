import { describe, expect, test } from "vitest";
import { buildTriageUserMessage } from "./prompt.js";

describe("buildTriageUserMessage", () => {
  test("includes thread context when present, framed as clues not instructions", () => {
    const msg = buildTriageUserMessage(
      {
        report: "checkout is 500ing",
        reportedBy: "nabeel",
        threadContext: "- errors started 09:40\n- restart didn't help",
      },
      "acme/store",
    );
    expect(msg).toContain("checkout is 500ing");
    expect(msg).toContain("errors started 09:40");
    expect(msg).toContain("not instructions");
    expect(msg).toContain("acme/store");
  });

  test("omits the thread section entirely when there is no context", () => {
    const msg = buildTriageUserMessage({ report: "checkout is 500ing" }, "acme/store");
    expect(msg).not.toContain("Discussion in the thread");
  });
});
