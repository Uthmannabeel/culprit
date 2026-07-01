import { renderTriageBlocks } from "../slack/blocks.js";
import { buildIncidentCanvasMarkdown } from "../slack/canvas.js";
import type { TriageResult } from "../triage/types.js";

/**
 * Design-review tooling (the incident.io practice: preview every message in
 * Block Kit Builder before shipping). Prints the verdict card's Block Kit JSON
 * — paste it into https://app.slack.com/block-kit-builder to see exactly what
 * users will see — plus the canvas markdown.
 *
 * Run: npm run preview:card
 */
const SAMPLE: TriageResult = {
  summary: "Checkout 500s after payment client refactor",
  rootCauseHypothesis:
    "Checkout requests fail with HTTP 500 because the payment client initialises with an undefined API key: PR #1 (commit ab9130b, merged 2026-06-25) renamed the env var STRIPE_API_KEY to PAYMENTS_API_KEY in src/payments.js, but production still sets the old name.",
  confidence: 90,
  severity: "sev1",
  suspectedOwner: "Uthmannabeel",
  evidence: [
    {
      kind: "past_incident",
      title: "Prior incident: payments failing at checkout after a deploy",
      url: "https://github.com/Uthmannabeel/culprit-demo-shop/pull/1",
      why: "Same symptom and mechanism; resolved by restoring the expected env var.",
    },
    {
      kind: "pull_request",
      title: "PR #1 — Refactor payment client initialisation",
      url: "https://github.com/Uthmannabeel/culprit-demo-shop/pull/1",
      why: "Merged the day the failures started; renames the payment key env var.",
    },
    {
      kind: "commit",
      title: "ab9130b — rename key to PAYMENTS_API_KEY",
      url: "https://github.com/Uthmannabeel/culprit-demo-shop/commit/ab9130bfc665484fa48fec24c452a41e3fde0b45",
      why: "src/payments.js now reads process.env.PAYMENTS_API_KEY.",
    },
  ],
  priorIncidents: [
    {
      id: "inc-2026-04-12-checkout-payments",
      symptom: "Payments failing at checkout with HTTP 500 right after a deploy",
      resolution: "Re-added the expected env var to production config; added a startup check.",
      resolvedBy: "dana",
      similarity: 0.75,
      url: "https://github.com/Uthmannabeel/culprit-demo-shop/pull/1",
    },
  ],
  recommendedActions: [
    "Set PAYMENTS_API_KEY in the production environment (or revert the rename in src/payments.js).",
    "Add a startup check that fails loudly when the payment key is missing.",
  ],
  draftIssue: {
    title: "Checkout 500s: payment API key env var renamed but not updated in prod",
    body: "…",
    labels: ["bug", "sev1"],
  },
};

const blocks = renderTriageBlocks(SAMPLE, "Uthmannabeel/culprit-demo-shop", "checkout is throwing 500s since this morning", {
  id: "F123CANVAS",
  url: "https://app.slack.com/canvas/F123CANVAS",
});

console.log("── Verdict card (paste into https://app.slack.com/block-kit-builder) ──\n");
console.log(JSON.stringify({ blocks }, null, 2));
console.log("\n── One-click Block Kit Builder link ──\n");
console.log(`https://app.slack.com/block-kit-builder/#${encodeURIComponent(JSON.stringify({ blocks }))}`);
console.log("\n── Incident canvas markdown ──\n");
console.log(buildIncidentCanvasMarkdown(SAMPLE, "Uthmannabeel/culprit-demo-shop", "checkout is throwing 500s since this morning", "nabeel"));
