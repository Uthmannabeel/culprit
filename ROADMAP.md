# Roadmap — the self-calibrating incident brain

**The idea Culprit is converging on:** every org's incidents should make its tooling
smarter, *provably*. Culprit's endgame is an **MCP-native evidence hub** with a
**memory that compounds** and a **confidence you can audit** — an agent whose "High"
means something because it is continuously scored against what actually fixed things.

Everything below extends what already ships: memory-first triage, the learning loop,
multi-signal GitHub evidence, alert auto-triage, the living Canvas, the App Home track
record, and the honest-scope discipline in [`LIMITATIONS.md`](./LIMITATIONS.md).

## Phase 1 — Evidence Hub: any MCP server is an evidence source ✅ SHIPPED

`EVIDENCE_MCP_SERVERS` lists any number of Streamable-HTTP MCP servers (Sentry,
Grafana, internal log search — anything speaking MCP), and their tools join the same
bounded agentic loop alongside memory and GitHub, on both brains. Per-source failure
isolation (a down server never breaks triage), per-source bearer auth, and generic
discovery/passthrough tools so no vendor code is ever written — the MCP ecosystem is
Culprit's integration surface. Verified against a real in-process MCP server in the
test suite.

- Remaining in this phase: stdio-launched servers, and citations that auto-tag their
  source in the verdict card.

## Phase 2 — Calibrated confidence: the track record feeds back

Today the track record is *displayed*; next it *acts*. When Culprit says "High" on
checkout-shaped incidents but history shows it was right 4 of 9 times there, the card
should say so: "High (model) · Medium (based on 9 similar outcomes here)".

- Deliverables: per-category outcome stats; displayed confidence tempered by measured
  accuracy; an offline eval harness (golden incident set + scored hypotheses) wired
  into CI with recorded fixtures so quality regressions fail the build.
- Acceptance: two confidence numbers on the card — claimed and earned — that diverge
  when they should.

## Phase 3 — From triage to resolution loop

- Incident grouping: multiple alerts/reports about one underlying cause collapse into
  one investigation (dedupe storms, one canvas, one thread).
- Draft-fix proposals: when the cause is a one-line config/env change, attach a draft
  PR (human-approved, same read/write discipline as issues).
- Post-incident: auto-drafted retro summary from the canvas + thread, one click to
  publish; the retro enriches memory with the *verified* mechanism, not just symptoms.

## Phase 4 — Memory at scale

- Pluggable store: JSON → SQLite → Postgres + pgvector behind the same IncidentMemory
  interface; encryption at rest; retention policies and a PII-scrub pass on write.
- Namespaced memory: per-team/per-service scopes with cross-scope recall labeled (the
  current same-repo boost, generalised).
- Verified memory: a second teammate's ✅ on a logged resolution marks it "confirmed";
  recall prefers confirmed entries. Memory becomes governed knowledge, not folklore.

## Phase 5 — Identity, trust, distribution

- Per-user GitHub OAuth so issues and PRs are filed *as the clicker*, with their
  permissions — retiring the shared-PAT model.
- Slack Connect gating, org RBAC for memory moderation, audit trail surfaced in App
  Home.
- Multi-workspace OAuth install flow → Slack App Directory listing.

## North star

An SRE joins a company, opens Culprit's App Home, and sees: 214 incidents remembered,
hypotheses correct or partially correct in 78% of logged outcomes, evidence drawn from
six MCP sources, every claim linkable in under 30 seconds. **Institutional memory with
receipts** — that is the product.
