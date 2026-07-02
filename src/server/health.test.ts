import { describe, expect, test } from "vitest";
import { buildHealthPayload } from "./health.js";

describe("buildHealthPayload", () => {
  test("reports ok with whole-second uptime", () => {
    expect(buildHealthPayload(1_000, 31_500)).toEqual({ status: "ok", service: "culprit", uptimeSeconds: 31 });
  });
});
