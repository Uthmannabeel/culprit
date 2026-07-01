# 🔍 Culprit

**Report the symptom. Culprit names the cause.**

Culprit is a Slack agent for the [Slack Agent Builder Challenge](https://slackhack.devpost.com/).
You report an incident in a channel — *"checkout is throwing 500s"* — and Culprit
investigates. First it asks **"have we seen this before?"** and recalls your org's past
resolved incidents from memory; then it gathers **real evidence** from GitHub over **MCP**
(merged PRs, commits, issues, files), forms the most likely **root-cause hypothesis**,
names the **suspected owner**, and drafts a **fileable GitHub issue** you can create with
one click — without leaving the thread.

> Culprit proposes a *hypothesis backed by evidence*, not a magic verdict. Every
> conclusion cites a real source it pulled. Honest scope is the point.

## Why it's different: institutional memory

Every other triage tool starts from zero on each incident. Culprit doesn't. The richest
incident data in any company already lives in Slack — every thread where the team
debugged something and the tribal knowledge of *who fixed what*. Culprit turns that into
a **searchable, compounding asset**: it remembers each resolved incident, recognizes when
a new symptom **rhymes** with a past one (*"we've seen this before — fixed by @dana, here's
what worked"*), and gets more confident with every incident it closes. That knowledge,
which normally evaporates in a thread, is something Sentry/Rootly can't touch — because it
lives in **your** Slack and GitHub history.

The loop closes in Slack: when an incident is fixed, click **✅ Resolve & teach Culprit**,
tell it *what actually fixed it*, and it writes that back to memory — so the calibrated
confidence is **earned**, not guessed. Try it headless with `npm run verify:learning`.

And it's **native to Slack's surfaces**: alongside the in-thread card, Culprit opens a
live **Slack Canvas** for each incident (symptom → hypothesis → evidence → owner) and
appends the resolution when you close it out — a durable, shareable record that doesn't
scroll away. (Canvas is best-effort: needs `canvases:write`; triage works without it.)

> **⚠️ The shipped memory is demo data.** `data/incidents.json` contains illustrative
> seed incidents so recall is visible out of the box. For real use, **delete them** (or
> point `INCIDENTS_DB_PATH` at your own store) — Culprit should only ever claim *your*
> org's actual history as "we've seen this before".

---

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
  Triage brain (Claude, agentic tool-use loop)
        │  gathers evidence ──▶ GitHub MCP server  (commits / PRs / issues / files)
        │  ◀── evidence
        ▼
  Structured verdict  → Block Kit card in-thread
        │
        └── [📝 Create GitHub issue] → GitHub REST → files the drafted issue
```

The brain runs a bounded agentic loop: Claude decides which GitHub MCP tools to
call, we execute them, feed results back, and repeat until it calls `submit_triage`
with a validated, structured verdict. See [`architecture_diagram.md`](./architecture_diagram.md).

The brain cross-checks **more than one signal** before concluding — recently merged
pull requests (the strongest "what changed / who to ask" clue), recent commits, open
issues, and a code search to locate the affected file — rather than betting on a single
source. Run `npm run verify:evidence` to confirm every signal works against your repo.

## Pluggable brain

Culprit ships two interchangeable brains, selected with `LLM_PROVIDER`:

- **`anthropic`** — Claude runs the agentic loop and gathers evidence over the **GitHub
  MCP server** (the consume-MCP path).
- **`gemini`** — a free-tier brain that gathers the same multi-signal evidence over the
  **GitHub REST API** (handy when an outbound MCP connection isn't available).

Either way Culprit **ships its own MCP server** (`triage_incident`), so the
"consume on one side, serve on the other" story holds regardless of brain.

## Stack

- **TypeScript** (ESM, Node ≥ 20)
- **[@slack/bolt](https://tools.slack.dev/bolt-js/) v4** in **Socket Mode**
- **[@anthropic-ai/sdk](https://github.com/anthropics/anthropic-sdk-typescript)** — `claude-opus-4-8`, adaptive thinking
- **[@google/genai](https://github.com/googleapis/js-genai)** — `gemini-2.5-flash` (free-tier brain)
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
- The agentic loop only ever **reads** over MCP. The write-path (filing an issue) is
  an explicit, human-clicked action via GitHub REST.
- Untrusted text is escaped before rendering in Slack.

## Project layout

```
src/
  config.ts            # validated env config
  index.ts             # entrypoint (Socket Mode)
  app.ts               # Bolt app wiring
  slack/handlers.ts    # @mention / DM triggers + issue/resolve actions
  slack/blocks.ts      # Block Kit rendering
  slack/resolve.ts     # "mark resolved" modal + record builder (learning loop)
  slack/canvas.ts      # living Slack Canvas incident doc
  triage/brain.ts      # provider switch (anthropic | gemini)
  triage/brainClaude.ts # agentic loop on Claude + GitHub MCP
  triage/brainGemini.ts # agentic loop on Gemini + GitHub REST evidence
  triage/prompt.ts     # system prompt (recall memory first, then evidence)
  triage/types.ts      # TriageResult schema (incl. priorIncidents)
  memory/store.ts      # incident memory: recall (embeddings) + remember
  memory/embeddings.ts # Gemini embeddings wrapper
  memory/similarity.ts # cosine + lexical-fallback scoring (pure, tested)
  mcp/githubClient.ts  # GitHub MCP client bridge
  github/evidence.ts   # read-only multi-signal evidence (commits/PRs/issues/code)
  github/issues.ts     # file an issue via GitHub REST
  server/triageMcpServer.ts  # Culprit's own MCP server
  demo/                # MCP client demo + evidence/memory verifiers
data/incidents.json    # seeded past incidents (the institutional memory)
.claude/               # ECC (Everything Claude Code) agent harness
```

## License

MIT — see [`LICENSE`](./LICENSE).
