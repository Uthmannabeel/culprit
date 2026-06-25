# Culprit — project instructions

This project uses the **ECC (Everything Claude Code)** agent harness. Follow the
agent instructions and rules in:

- `.claude/AGENTS.md` — agent orchestration, principles, workflow
- `.claude/rules/ecc/common/` — language-agnostic standards (coding-style, testing, security, git)
- `.claude/rules/ecc/web/` — TypeScript/web specifics

## What this is

A Slack agent (the **SlackHack "Slack Agent Builder Challenge"** entry) that turns
an incident report posted in Slack into a root-cause hypothesis, suspected owner,
and a draft GitHub issue — by gathering real evidence over **MCP**.

## Stack

- TypeScript (ESM, Node ≥ 20), `tsx` for dev.
- `@slack/bolt` v4 in **Socket Mode** (outbound WebSocket — no public URL needed).
- `@anthropic-ai/sdk` — the triage brain (`claude-opus-4-8`, adaptive thinking).
- `@modelcontextprotocol/sdk` — consumes the GitHub MCP server (read-only context)
  AND exposes Triage's own MCP server (`npm run mcp`).

## Run

`npm run dev` (needs `.env` — see `.env.example`). `npm test`, `npm run typecheck`.

## Environment note (this machine)

Corporate TLS interception: prefix npm/npx with `$env:NODE_OPTIONS="--use-system-ca"`.
