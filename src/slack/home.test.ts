import { describe, expect, test } from "vitest";
import { buildHomeView } from "./home.js";

describe("buildHomeView", () => {
  test("publishes the earned track record when outcomes exist", () => {
    const view = buildHomeView({
      incidents: 8,
      resolved: 6,
      hypothesisCorrect: 4,
      hypothesisPartial: 1,
      hypothesisIncorrect: 1,
    });
    const text = JSON.stringify(view);
    expect(view.type).toBe("home");
    expect(text).toContain("Incidents remembered: *8*");
    expect(text).toContain("*6* logged resolutions");
    expect(text).toContain("Correct: *4*");
    expect(text).toContain("Incorrect: *1*");
    expect(text).toContain("self-reported from your team");
  });

  test("explains the learning loop when nothing is logged yet", () => {
    const view = buildHomeView({
      incidents: 0,
      resolved: 0,
      hypothesisCorrect: 0,
      hypothesisPartial: 0,
      hypothesisIncorrect: 0,
    });
    const text = JSON.stringify(view);
    expect(text).toContain("No logged resolutions yet");
    expect(text).toContain("Log resolution");
  });
});
