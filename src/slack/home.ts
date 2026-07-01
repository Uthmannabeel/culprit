import type { HomeView } from "@slack/types";
import type { MemoryStats } from "../memory/store.js";

/**
 * Culprit's App Home. Two jobs: teach a first-time user how to use it in one
 * glance, and publish Culprit's EARNED track record — hypothesis outcomes
 * captured through the learning loop, not a marketing number. An agent that
 * shows its own scorecard is an agent you can calibrate trust against.
 */
export function buildHomeView(stats: MemoryStats): HomeView {
  const outcomes = stats.hypothesisCorrect + stats.hypothesisPartial + stats.hypothesisIncorrect;
  const trackRecord =
    outcomes === 0
      ? "_No logged resolutions yet. After an incident is fixed, click *Log resolution* on a verdict — Culprit records what actually fixed it and scores its own hypothesis._"
      : [
          `Across *${outcomes}* logged resolution${outcomes === 1 ? "" : "s"}, Culprit's hypothesis was:`,
          `• Correct: *${stats.hypothesisCorrect}*`,
          `• Partially correct: *${stats.hypothesisPartial}*`,
          `• Incorrect: *${stats.hypothesisIncorrect}*`,
        ].join("\n");

  return {
    type: "home",
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: "Culprit — incident triage with memory" },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            "Report a symptom and Culprit investigates: it recalls how similar incidents were fixed before, cross-checks recent changes on GitHub, and posts a root-cause hypothesis with linked evidence, a suggested owner, and a ready-to-file issue.",
        },
      },
      { type: "divider" },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: [
            "*How to use it*",
            "1. Mention it where the incident is being discussed: `@Culprit checkout is throwing 500s repo:owner/name` (or send a DM).",
            "2. Review the verdict — every claim links to the commit, PR, issue, or past incident behind it.",
            "3. `Create GitHub issue` files the pre-drafted issue. `Log resolution` records what actually fixed it.",
          ].join("\n"),
        },
      },
      { type: "divider" },
      {
        type: "section",
        text: { type: "mrkdwn", text: `*Institutional memory*\nIncidents remembered: *${stats.incidents}*` },
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: `*Track record*\n${trackRecord}` },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: "Culprit proposes hypotheses, not verdicts — outcomes above are self-reported from your team's logged resolutions.",
          },
        ],
      },
    ],
  };
}
