# 🔍 Culprit

**Report the symptom. Culprit names the cause.**

Culprit is a Slack agent for the [Slack Agent Builder Challenge](https://slackhack.devpost.com/).
You report an incident in a channel — *"checkout is throwing 500s"* — and Culprit
investigates: it gathers **real evidence** from your GitHub repo over **MCP**
(recent commits, pull requests, issues, files touching the affected area), forms
the most likely **root-cause hypothesis**, names the **suspected owner**, and drafts
a **fileable GitHub issue** you can create with one click — without leaving the thread.

> Culprit proposes a *hypothesis backed by evidence*, not a magic verdict. Every
> conclusion cites a real source it pulled. Honest scope is the point.

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

## Stack

- **TypeScript** (ESM, Node ≥ 20)
- **[@slack/bolt](https://tools.slack.dev/bolt-js/) v4** in **Socket Mode**
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
| `npm run typecheck` | Type-check the project |
| `npm test` | Run the test suite |

## Configuration

See [`.env.example`](./.env.example). You need:

- A **Slack app** (bot token `xoxb-…` + app-level token `xapp-…`). Create it from
  [`manifest.json`](./manifest.json) — see [`docs/SETUP.md`](./docs/SETUP.md).
- An **Anthropic API key**.
- A **GitHub token** with repo read (and `issues: write` to file issues), plus a
  default `owner/repo`.

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
  slack/handlers.ts    # @mention / DM triggers + create-issue action
  slack/blocks.ts      # Block Kit rendering
  triage/brain.ts      # agentic tool-use loop (Claude + GitHub MCP)
  triage/prompt.ts     # system prompt
  triage/types.ts      # TriageResult schema
  mcp/githubClient.ts  # GitHub MCP client bridge
  github/issues.ts     # file an issue via GitHub REST
  server/triageMcpServer.ts  # Culprit's own MCP server
.claude/               # ECC (Everything Claude Code) agent harness
```

## License

MIT — see [`LICENSE`](./LICENSE).
