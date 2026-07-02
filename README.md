# Culprit

**Report the symptom. Culprit names the cause — and remembers what fixed it.**

[![CI](https://github.com/Uthmannabeel/culprit/actions/workflows/ci.yml/badge.svg)](https://github.com/Uthmannabeel/culprit/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](./tsconfig.json)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-339933?logo=node.js&logoColor=white)](./package.json)

Culprit is a Slack agent for the [Slack Agent Builder Challenge](https://slackhack.devpost.com/).
You report an incident in a channel — *"checkout is throwing 500s"* — and Culprit
investigates. First it asks **"have we seen this before?"** and recalls your org's past
resolved incidents from memory; then it gathers **real evidence** from GitHub over **MCP**
(merged PRs, commits, issues, files), forms the most likely **root-cause hypothesis**,
names the **suggested owner**, and drafts a **fileable GitHub issue** you can create with
one click — without leaving the thread.

> Culprit proposes a *hypothesis backed by evidence*, not a magic verdict. Every
> conclusion cites a real source it pulled. Honest scope is the point.

## The difference at a glance

| | Typical triage bot | Culprit |
|---|---|---|
| Each new incident | Starts from zero | **Recalls how similar incidents were actually fixed, and by whom** |
| Confidence | A decorated guess | **Earned** — scored against logged outcomes, shown as words, never fake percentages |
| Evidence | "Trust me" prose | **Numbered links** to the exact PR / commit / file / past incident, verifiable in seconds |
| After the incident | Forgets | **Learns** — "Log resolution" writes the real fix back to memory |
| Record | A card that scrolls away | A **living Canvas** incident doc + an App Home **track record** |

## Why it's different: institutional memory

Every other triage tool starts from zero on each incident. Culprit doesn't. The richest
incident data in any company already lives in Slack — every thread where the team
debugged something and the tribal knowledge of *who fixed what*. Culprit turns that into
a **searchable, compounding asset**: it remembers each resolved incident, recognizes when
a new symptom **rhymes** with a past one (*"strong match — resolved by dana, here's what
worked"*), and gets more confident with every incident it closes. That knowledge, which
normally evaporates in a thread, is something external tools can't replicate — because it
lives in **your** Slack and GitHub history.

The loop closes in Slack: when an incident is fixed, click **Log resolution**, tell it
*what actually fixed it* and whether the hypothesis was right — and it writes that back
to memory. Culprit then publishes its **track record on its App Home**: hypothesis
outcomes across your logged resolutions, self-reported from real results. Confidence is
**earned**, not guessed. Try it headless with `npm run verify:learning`.

And it's **native to Slack's surfaces**: alongside the in-thread card, Culprit opens a
live **Slack Canvas** for each incident (symptom → hypothesis → evidence → owner) and
appends the resolution when you close it out — a durable, shareable record that doesn't
scroll away. (Canvas is best-effort: needs `canvases:write`; triage works without it.)

> **⚠️ The shipped memory is demo data.** `data/incidents.json` contains illustrative
> seed incidents so recall is visible out of the box. For real use, **delete them** (or
> point `INCIDENTS_DB_PATH` at your own store) — Culprit should only ever claim *your*
> org's actual history as a prior incident match.

## What a triage looks like

1. `@Culprit checkout is throwing 500s` — the status line narrates the investigation
   live (*"Checking past incidents for a match…"*, *"Reviewing recently merged pull requests…"*).
2. The **verdict card** lands: severity, categorical confidence, a **prior incident
   match** (what fixed it last time, and who), the causal hypothesis with exact
   identifiers, numbered evidence links, and suggested next steps.
3. **Create GitHub issue** files the pre-drafted, labelled issue.
4. **Log resolution** records the real fix — the next similar incident recalls it.

The card follows the design conventions of the best incident tooling (incident.io,
Rootly, Datadog, and Slack's own Block Kit guidance): one severity signal, categorical
confidence, linked evidence, no decoration.
**[See the exact card rendered in Slack's Block Kit Builder →](https://app.slack.com/block-kit-builder/#%7B%22blocks%22%3A%5B%7B%22type%22%3A%22header%22%2C%22text%22%3A%7B%22type%22%3A%22plain_text%22%2C%22text%22%3A%22Checkout%20500s%20after%20payment%20client%20refactor%22%2C%22emoji%22%3Atrue%7D%7D%2C%7B%22type%22%3A%22section%22%2C%22fields%22%3A%5B%7B%22type%22%3A%22mrkdwn%22%2C%22text%22%3A%22*Severity%3A*%5Cn%F0%9F%94%B4%20Critical%20(SEV1)%22%7D%2C%7B%22type%22%3A%22mrkdwn%22%2C%22text%22%3A%22*Confidence%3A*%5CnHigh%22%7D%2C%7B%22type%22%3A%22mrkdwn%22%2C%22text%22%3A%22*Repository%3A*%5Cn%60Uthmannabeel%2Fculprit-demo-shop%60%22%7D%2C%7B%22type%22%3A%22mrkdwn%22%2C%22text%22%3A%22*Suggested%20owner%3A*%5CnUthmannabeel%22%7D%5D%7D%2C%7B%22type%22%3A%22section%22%2C%22text%22%3A%7B%22type%22%3A%22mrkdwn%22%2C%22text%22%3A%22*Likely%20root%20cause*%5CnCheckout%20requests%20fail%20with%20HTTP%20500%20because%20the%20payment%20client%20initialises%20with%20an%20undefined%20API%20key%3A%20PR%20%231%20(commit%20ab9130b%2C%20merged%202026-06-25)%20renamed%20the%20env%20var%20STRIPE_API_KEY%20to%20PAYMENTS_API_KEY%20in%20src%2Fpayments.js%2C%20but%20production%20still%20sets%20the%20old%20name.%22%7D%7D%2C%7B%22type%22%3A%22section%22%2C%22text%22%3A%7B%22type%22%3A%22mrkdwn%22%2C%22text%22%3A%22*Prior%20incident%20match*%5Cn*Strong%20match*%20%E2%80%94%20Payments%20failing%20at%20checkout%20with%20HTTP%20500%20right%20after%20a%20deploy%20(%3Chttps%3A%2F%2Fgithub.com%2FUthmannabeel%2Fculprit-demo-shop%2Fpull%2F1%7Cdetails%3E).%20Resolved%20by%20dana.%20Fix%20at%20the%20time%3A%20Re-added%20the%20expected%20env%20var%20to%20production%20config%3B%20added%20a%20startup%20check.%22%7D%7D%2C%7B%22type%22%3A%22section%22%2C%22text%22%3A%7B%22type%22%3A%22mrkdwn%22%2C%22text%22%3A%22*Evidence*%5Cn1.%20%3Chttps%3A%2F%2Fgithub.com%2FUthmannabeel%2Fculprit-demo-shop%2Fpull%2F1%7CPrior%20incident%3A%20payments%20failing%20at%20checkout%20after%20a%20deploy%3E%20%E2%80%94%20Same%20symptom%20and%20mechanism%3B%20resolved%20by%20restoring%20the%20expected%20env%20var.%5Cn2.%20%3Chttps%3A%2F%2Fgithub.com%2FUthmannabeel%2Fculprit-demo-shop%2Fpull%2F1%7CPR%20%231%20%E2%80%94%20Refactor%20payment%20client%20initialisation%3E%20%E2%80%94%20Merged%20the%20day%20the%20failures%20started%3B%20renames%20the%20payment%20key%20env%20var.%5Cn3.%20%3Chttps%3A%2F%2Fgithub.com%2FUthmannabeel%2Fculprit-demo-shop%2Fcommit%2Fab9130bfc665484fa48fec24c452a41e3fde0b45%7Cab9130b%20%E2%80%94%20rename%20key%20to%20PAYMENTS_API_KEY%3E%20%E2%80%94%20src%2Fpayments.js%20now%20reads%20process.env.PAYMENTS_API_KEY.%22%7D%7D%2C%7B%22type%22%3A%22section%22%2C%22text%22%3A%7B%22type%22%3A%22mrkdwn%22%2C%22text%22%3A%22*Suggested%20next%20steps*%5Cn1.%20Set%20PAYMENTS_API_KEY%20in%20the%20production%20environment%20(or%20revert%20the%20rename%20in%20src%2Fpayments.js).%5Cn2.%20Add%20a%20startup%20check%20that%20fails%20loudly%20when%20the%20payment%20key%20is%20missing.%22%7D%7D%2C%7B%22type%22%3A%22divider%22%7D%2C%7B%22type%22%3A%22section%22%2C%22text%22%3A%7B%22type%22%3A%22mrkdwn%22%2C%22text%22%3A%22*Draft%20issue%3A*%20Checkout%20500s%3A%20payment%20API%20key%20env%20var%20renamed%20but%20not%20updated%20in%20prod%20%C2%B7%20%60bug%60%20%60sev1%60%22%7D%7D%2C%7B%22type%22%3A%22actions%22%2C%22elements%22%3A%5B%7B%22type%22%3A%22button%22%2C%22style%22%3A%22primary%22%2C%22text%22%3A%7B%22type%22%3A%22plain_text%22%2C%22text%22%3A%22Create%20GitHub%20issue%22%7D%2C%22action_id%22%3A%22triage_create_issue%22%2C%22value%22%3A%22%7B%5C%22repo%5C%22%3A%5C%22Uthmannabeel%2Fculprit-demo-shop%5C%22%2C%5C%22issue%5C%22%3A%7B%5C%22title%5C%22%3A%5C%22Checkout%20500s%3A%20payment%20API%20key%20env%20var%20renamed%20but%20not%20updated%20in%20prod%5C%22%2C%5C%22body%5C%22%3A%5C%22%E2%80%A6%5C%22%2C%5C%22labels%5C%22%3A%5B%5C%22bug%5C%22%2C%5C%22sev1%5C%22%5D%7D%7D%22%7D%2C%7B%22type%22%3A%22button%22%2C%22text%22%3A%7B%22type%22%3A%22plain_text%22%2C%22text%22%3A%22Log%20resolution%22%7D%2C%22action_id%22%3A%22triage_mark_resolved%22%2C%22value%22%3A%22%7B%5C%22symptom%5C%22%3A%5C%22checkout%20is%20throwing%20500s%20since%20this%20morning%5C%22%2C%5C%22hypothesis%5C%22%3A%5C%22Checkout%20requests%20fail%20with%20HTTP%20500%20because%20the%20payment%20client%20initialises%20with%20an%20undefined%20API%20key%3A%20PR%20%231%20(commit%20ab9130b%2C%20merged%202026-06-25)%20renamed%20the%20env%20var%20STRIPE_API_KEY%20to%20PAYMENTS_API_KEY%20in%20src%2Fpayments.js%2C%20but%20production%20still%20sets%20the%20old%20name.%5C%22%2C%5C%22repo%5C%22%3A%5C%22Uthmannabeel%2Fculprit-demo-shop%5C%22%2C%5C%22suspectedOwner%5C%22%3A%5C%22Uthmannabeel%5C%22%2C%5C%22link%5C%22%3A%5C%22https%3A%2F%2Fgithub.com%2FUthmannabeel%2Fculprit-demo-shop%2Fpull%2F1%5C%22%2C%5C%22channel%5C%22%3Anull%2C%5C%22threadTs%5C%22%3Anull%2C%5C%22canvasId%5C%22%3A%5C%22F123CANVAS%5C%22%7D%22%7D%5D%7D%2C%7B%22type%22%3A%22context%22%2C%22elements%22%3A%5B%7B%22type%22%3A%22mrkdwn%22%2C%22text%22%3A%22Culprit%20%C2%B7%20AI-generated%20hypothesis%2C%20not%20a%20verdict%20%E2%80%94%20every%20claim%20links%20to%20its%20source%20%C2%B7%20Verify%20before%20acting%20%C2%B7%20%3Chttps%3A%2F%2Fapp.slack.com%2Fcanvas%2FF123CANVAS%7CIncident%20canvas%3E%22%7D%5D%7D%5D%7D)**
(or run `npm run preview:card` to regenerate it).

## Why it fits the challenge

The challenge requires using **at least one** of: Slack AI capabilities, **MCP server
integration**, or the Real-Time Search API. Culprit is built around MCP — and uses it
on **both** sides:

- **Consumes** the GitHub MCP server as its evidence source (read-only).
- **Ships** its own MCP server (`triage_incident`) so any other agent can call Culprit.

Track: **New Slack Agent / Slack Agent for Organizations**.

## How it works

```
@Culprit checkout is 500ing repo:acme/store
        │
        ▼
  Slack (Socket Mode, Bolt)         ← outbound WebSocket, no public URL
        │
        ▼
  Triage brain (Gemini or Claude, bounded agentic loop)
        │  1. recall ──▶ Incident memory   ("we've solved this before" + the fix)
        │  2. evidence ─▶ GitHub (MCP or REST: merged PRs / commits / issues / code)
        ▼
  Verdict card in-thread  +  living incident Canvas
        │
        ├── [Create GitHub issue] → GitHub REST (allowlisted) → files the draft
        └── [Log resolution] → what actually fixed it → written back to memory
```

The brain runs a bounded agentic loop: the model decides which evidence tools to call,
Culprit executes them, feeds results back, and repeats until the model calls
`submit_triage` with a validated, structured verdict.
See [`architecture_diagram.md`](./architecture_diagram.md).

The brain cross-checks **more than one signal** before concluding — recently merged
pull requests (the strongest "what changed / who to ask" clue), recent commits (scopable
to the affected file), **deployments**, **CI workflow runs**, open issues, and a code
search (with a filename fallback for unindexed repos) — rather than betting on a single
source. Run `npm run verify:evidence` to confirm every signal works against your repo.

And evidence isn't limited to GitHub: the **Evidence Hub** (`EVIDENCE_MCP_SERVERS`)
plugs **any MCP server** into the same loop — point it at an error tracker's or log
platform's MCP server and its tools become triage evidence, with zero integration code.
The MCP ecosystem *is* the integration surface.

Beyond @mentions, Culprit can watch **alert channels** (`ALERT_CHANNELS`): a webhook
post from Sentry/PagerDuty/Datadog landing there is auto-triaged, no mention needed.
Memory is manageable in-channel too — `@Culprit memory` shows what it knows,
`@Culprit forget <id>` removes an entry, and `npm run import:issues` bootstraps memory
from your repo's closed issues.

Culprit is honest about what it can't do — see [`LIMITATIONS.md`](./LIMITATIONS.md) —
and explicit about where it's going: [`ROADMAP.md`](./ROADMAP.md).

## Pluggable brain

Culprit ships two interchangeable brains, selected with `LLM_PROVIDER`:

- **`gemini`** (default) — a free-tier brain that gathers multi-signal evidence over the
  **GitHub REST API** (reliable even where an outbound MCP connection isn't available).
- **`anthropic`** — Claude runs the agentic loop and gathers evidence over the **GitHub
  MCP server** (the consume-MCP path).

Either way Culprit **ships its own MCP server** (`triage_incident`), so the
"consume on one side, serve on the other" story holds regardless of brain.

## Stack

- **TypeScript** (ESM, strict, Node ≥ 20) — typechecked and tested in [CI](./.github/workflows/ci.yml)
- **[@slack/bolt](https://tools.slack.dev/bolt-js/) v4** in **Socket Mode**
- **[@google/genai](https://github.com/googleapis/js-genai)** — `gemini-2.5-flash` + `gemini-embedding-001` (free-tier brain + memory)
- **[@anthropic-ai/sdk](https://github.com/anthropics/anthropic-sdk-typescript)** — `claude-opus-4-8`, adaptive thinking
- **[@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol)** — GitHub MCP client + Culprit's own MCP server

## Quick start

```bash
npm install
cp .env.example .env     # fill in the values (see below)
npm run dev              # starts Culprit in Socket Mode
```

Then in Slack: `@Culprit the login page is throwing 500s repo:owner/repo`, or DM it.

Run Culprit's own MCP server (for other agents to call):

```bash
npm run mcp
```

| Command | What it does |
|---|---|
| `npm run dev` | Start the Slack agent (Socket Mode) with hot reload |
| `npm start` | Start the Slack agent |
| `npm run mcp` | Start Culprit's MCP server (stdio) |
| `npm run demo:mcp` | Call Culprit's MCP server as an external agent (no Slack needed) |
| `npm run verify:evidence` | Check every GitHub evidence signal works against your repo |
| `npm run verify:memory` | Check incident recall (embeddings) against the seeded memory |
| `npm run verify:learning` | Prove the learning loop: remember an incident, then recall it |
| `npm run preview:card` | Print the verdict card's Block Kit JSON + a Block Kit Builder link |
| `npm run list:models` | List which embedding models your Gemini key supports |
| `npm run typecheck` | Type-check the project |
| `npm test` | Run the test suite |

## Configuration

See [`.env.example`](./.env.example). You need:

- A **Slack app** (bot token `xoxb-…` + app-level token `xapp-…`). Create it from
  [`manifest.json`](./manifest.json) — see [`docs/SETUP.md`](./docs/SETUP.md).
- A **brain key**: a **Gemini API key** (`LLM_PROVIDER=gemini`, free tier) or an
  **Anthropic API key** (`LLM_PROVIDER=anthropic`).
- A **GitHub token** with read on Contents, Pull requests, and Issues (plus
  `Issues: write` to file issues), and a default `owner/repo`.

## Security

- Secrets come from the environment and are validated at startup; `.env` is gitignored.
- The agentic loop only ever **reads**. The write-path (filing an issue) is an explicit,
  human-clicked action via GitHub REST, restricted to an **allowlist of repos**.
- Untrusted text is escaped at every sink (Block Kit mrkdwn, Canvas markdown, modals),
  URLs are validated http(s)-only, and payload sizes are clamped to Slack's limits.

## Project layout

```
src/
  config.ts            # validated env config + issue-repo allowlist
  index.ts             # entrypoint (Socket Mode)
  app.ts               # Bolt app wiring
  slack/handlers.ts    # mention/DM/App-Home triggers + issue/resolve actions
  slack/blocks.ts      # verdict card (Block Kit)
  slack/format.ts      # shared design tokens + text-safety helpers
  slack/home.ts        # App Home: usage + earned track record
  slack/resolve.ts     # "Log resolution" modal (the learning loop)
  slack/canvas.ts      # living Slack Canvas incident doc
  slack/draftStore.ts  # button-payload store (Slack 2000-char limit) + idempotency
  slack/parse.ts       # report/repo parsing (Slack link formats)
  triage/brain.ts      # provider switch (gemini | anthropic)
  triage/brainGemini.ts / brainClaude.ts   # bounded agentic loops
  triage/recall.ts     # shared memory-recall glue (both brains)
  triage/prompt.ts     # system prompt (memory first; senior-engineer voice)
  triage/types.ts      # TriageResult schema (incl. priorIncidents)
  memory/store.ts      # incident memory: recall / remember / stats
  memory/embeddings.ts # Gemini embeddings (sidecar cache)
  memory/similarity.ts # cosine + lexical-fallback scoring (pure, tested)
  mcp/githubClient.ts  # GitHub MCP client bridge
  github/evidence.ts   # read-only multi-signal evidence
  github/issues.ts     # file an issue via GitHub REST
  server/triageMcpServer.ts  # Culprit's own MCP server
  demo/                # verifiers + MCP client demo + card preview
data/incidents.json    # seeded past incidents (demo data — see note above)
```

## License

MIT — see [`LICENSE`](./LICENSE).
