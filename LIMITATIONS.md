# Limitations & honest scope

Culprit's brand is *hypothesis with receipts, not a magic verdict* — that honesty extends
to the system itself. What follows is what Culprit deliberately does not do (yet), and
what any operator should know before trusting it.

## The model can be confidently wrong

Every verdict is LLM-generated. Culprit constrains this — every claim must cite retrieved
evidence, confidence is categorical and prompt-calibrated, writes require a human click,
and the App Home publishes a track record from logged outcomes — but no constraint makes
a language model infallible. Treat every verdict as a well-researched starting point.

## Evidence is GitHub-shaped

Culprit sees code changes, PRs, issues, deployments, and CI runs. It does not see logs,
metrics, traces, or feature flags, so causes with no GitHub footprint (expired certs,
quota exhaustion, upstream outages, config drift outside the repo) are invisible, and it
carries a structural bias toward "a recent change did it". Wiring log/metric MCP servers
into the same loop is the first roadmap item. Triage is also **single-repo per incident**
— no cross-service causal reasoning yet.

## Memory is only as good as what gets logged

- **It compounds through use.** If nobody clicks *Log resolution*, Culprit stays
  amnesiac. `npm run import:issues` softens the cold start by importing closed GitHub
  issues as recallable prior reports (without inventing resolutions).
- **It's trust-on-write.** Any workspace member can log a resolution; there is no
  verification of truth. Moderation exists (`@Culprit memory` to inspect,
  `@Culprit forget <id>` to remove) but no approval workflow.
- **Similarity is symptom-based.** Rhyming symptoms can have different causes; the
  prompt treats recalls as leads to verify, not answers, but anchoring risk is real.

## Free-tier quotas are real

The default brain runs on Gemini's free tier, which caps requests per minute *and per
day* — a busy incident day (or heavy rehearsal) can exhaust it. Culprit caps concurrent
investigations (`MAX_CONCURRENT_TRIAGES`), tells users plainly when the brain is
rate-limited, and supports swapping keys/models via env — but sustained production use
needs a paid tier.

## Storage is deliberately simple

A JSON file with atomic writes and per-path write locking. Correct for a single-process
deployment; **not** multi-instance-safe, not encrypted at rest, no retention policy, no
multi-workspace tenancy. A real deployment would put memory behind a database.

## Platform constraints

- **Single process, Socket Mode** — no high availability. Oversized draft issues and
  idempotency state are held in-process; a restart degrades them gracefully (users are
  told to re-run) but does not preserve them.
- **Slack Canvas** requires the `canvases:write` scope and (for standalone canvases) a
  paid Slack plan. Culprit degrades gracefully — triage works fully without the canvas.
- **One GitHub identity.** Issues are filed under a single token, governed by a repo
  allowlist — there is no per-user GitHub OAuth, so no per-user attribution or
  permissions on the write path.
- **Alert ingestion is Slack-native only**: Culprit auto-triages messages landing in
  configured alert channels (`ALERT_CHANNELS`), which covers webhook-to-Slack setups
  (Sentry/PagerDuty/Datadog → channel), but it has no direct API integrations.

## Verification honesty

Pure logic is unit-tested (CI runs the full suite on every push) and every core
capability has a headless verifier (`verify:evidence`, `verify:memory`,
`verify:learning`, `demo:mcp`). The live Slack wiring (canvas, App Home, modals) is
exercised manually, not by integration tests, and the Claude/MCP brain path — while
identical in structure to the proven Gemini path — has not been run end-to-end in this
development environment.
