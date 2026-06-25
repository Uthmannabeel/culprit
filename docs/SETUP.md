# Setup — creating the Slack app and credentials

These are the **human-only** steps (they need accounts/credentials Claude can't
create for you). Everything else is built.

## 1. Create the Slack app (≈3 min)

1. Go to <https://api.slack.com/apps> → **Create New App** → **From a manifest**.
2. Pick your workspace (use a **developer sandbox** — the hackathon asks for a sandbox URL).
3. Paste the contents of [`../manifest.json`](../manifest.json) → Create.
4. **Install to Workspace** (Settings → Install App). Copy the **Bot User OAuth Token**
   (`xoxb-…`) → `SLACK_BOT_TOKEN`.
5. **Basic Information → App-Level Tokens → Generate** a token with scope
   `connections:write`. Copy it (`xapp-…`) → `SLACK_APP_TOKEN`.

> The manifest already enables Socket Mode, the right scopes, and the
> `app_mention` / `message.im` events — no public URL needed.

## 2. Anthropic API key

From <https://console.anthropic.com/> → API keys → `ANTHROPIC_API_KEY`.

## 3. GitHub token

A token with **repo read** access (and **issues: write** to file issues from Slack).
A fine-grained PAT scoped to the repo(s) you'll demo against is ideal.
→ `GITHUB_TOKEN`, and set `GITHUB_DEFAULT_REPO=owner/repo`.

## 4. Run it

```bash
cp .env.example .env   # paste the four values above
npm install
npm run dev
```

In Slack: invite the bot to a channel, then `@Culprit <what's broken> repo:owner/repo`.

## 5. Submission checklist (Devpost)

- [ ] Project track selected
- [ ] Text description (see [`DEVPOST.md`](./DEVPOST.md))
- [ ] ~3-min demo video (see [`DEMO_SCRIPT.md`](./DEMO_SCRIPT.md))
- [ ] Architecture diagram ([`../architecture_diagram.md`](../architecture_diagram.md))
- [ ] URL to your Slack developer sandbox (grant access to the emails the rules specify)
- [ ] Public repo + OSS license (MIT)

## Security reminder

Rotate every credential after the hackathon (Slack tokens, Anthropic key, GitHub
token) — especially any pasted into a chat.
