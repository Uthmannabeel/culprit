# Culprit — Devpost submission

**Report the symptom. Culprit names the cause.**

## Inspiration

When a service breaks, responders burn the first 20 minutes on two questions:
*what changed?* and *who owns it?* That triage is mechanical, repetitive, and
happens under pressure — exactly the kind of work an agent should do. And it should
happen where the incident is already being discussed: **Slack**.

## What it does

You report an incident in a Slack channel in plain language — *"checkout is throwing
500s"* — optionally naming a repo. Culprit:

1. **Gathers real evidence** from GitHub over **MCP** — recent commits, pull requests,
   issues, and files touching the affected area.
2. Forms the single most likely **root-cause hypothesis**.
3. Names the **suspected owner** from commit/PR authorship.
4. Posts a **Block Kit verdict card** in-thread: hypothesis, calibrated confidence,
   severity, and **evidence that links back to real sources**.
5. Offers a **one-click "Create GitHub issue"** button that files a pre-drafted,
   labelled issue via the GitHub REST API.

Crucially, Culprit proposes a **hypothesis backed by evidence**, not a magic verdict.
Every claim links to something it actually retrieved, and confidence is calibrated to
how much evidence it found. Honest scope is a feature.

## How we built it

- **Slack:** `@slack/bolt` v4 in **Socket Mode** — an outbound WebSocket, so Culprit
  runs anywhere (including behind a corporate firewall) with no public URL.
- **Brain (pluggable):** a bounded **agentic tool-use loop** that decides which GitHub
  tools to call, executes them, and feeds results back until it calls a structured
  `submit_triage` finalizer returning a validated verdict. Two interchangeable brains:
  the Anthropic SDK driving `claude-opus-4-8` (adaptive thinking) over the GitHub MCP
  server, or a free-tier `gemini-2.5-flash` brain over the GitHub REST API.
- **Multi-signal evidence:** rather than betting on one source, Culprit cross-checks
  recently merged **pull requests** (the strongest "what changed / who to ask" clue),
  recent **commits**, open **issues**, and a **code search** to locate the affected file.
- **MCP on both sides:** Culprit **consumes** the GitHub MCP server as its read-only
  evidence source, and **ships its own** MCP server exposing a `triage_incident` tool,
  so any other MCP-speaking agent can reuse Culprit — regardless of which brain runs.
- **Write-path:** filing the issue is a deterministic, explicit, human-clicked GitHub
  REST call — the autonomous loop itself is read-only.
- Built on the **ECC (Everything Claude Code)** agent harness; TypeScript, tested,
  type-checked.

## How it meets the requirements

The challenge requires using at least one of Slack AI capabilities, MCP server
integration, or the Real-Time Search API. **Culprit is built around MCP integration —
on both the consuming and the serving side.**

## Challenges

- Keeping the agent **honest**: forcing every conclusion to cite retrieved evidence and
  calibrating confidence, rather than producing confident-sounding guesses.
- Bounding the agentic loop so it always converges on a render-ready, validated verdict.
- Splitting read (MCP, autonomous) from write (REST, human-approved) for safety.

## What's next

- Pull in logs/metrics MCP servers as additional evidence sources.
- A read-only "explain this PR's blast radius" mode.
- Per-team ownership maps to sharpen the suspected-owner step.

## Try it

Public repo with full setup instructions and an architecture diagram. Run
`npm run dev`, mention `@Culprit` with an incident, and watch it work.

## Links

- Repository: https://github.com/Uthmannabeel/culprit
- Demo video: _(add link)_
- Architecture diagram: `architecture_diagram.md` in the repo
