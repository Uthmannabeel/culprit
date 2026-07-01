# Culprit — 3-minute demo script

**Goal:** show the full loop — a plain incident report in Slack becomes a triaged,
evidence-backed verdict and a filed GitHub issue — and make the MCP story explicit.

**Setup before recording:** `npm run dev` running; bot invited to a demo channel;
`GITHUB_DEFAULT_REPO` pointing at a repo that has a real, recent breaking change
(seed one if needed — e.g. a commit/PR that removes an env-var read). Pick the brain
with `LLM_PROVIDER` (`gemini` for the free-tier path, `anthropic` for Claude+MCP).
Sanity-check evidence access first with `npm run verify:evidence`.

---

### 0:00 — The problem (20s)
> "When something breaks, the first 20 minutes are spent figuring out *what changed*
> and *who owns it*. Culprit does that first pass for you — inside Slack."

### 0:20 — Report an incident (25s)
Type in the channel:
> `@Culprit checkout is throwing 500s since this morning repo:acme/store`

Culprit replies **🔍 Investigating…** and the status updates live
(*"Checking GitHub: list_recent_pull_requests"*) — point out it's **gathering real,
multi-signal evidence** (merged PRs, commits, issues, code), not guessing.

### 0:45 — The verdict (45s)
The card lands. Walk through it:
- **🧠 We've seen this before** — a similar past incident, what fixed it, and who. This
  is the wedge: *"Culprit recognised this matches an incident dana resolved in April."*
- **Likely cause (hypothesis)** — names the suspect change.
- **Evidence** — each line links to a **real** commit / PR / file it pulled.
- **Suspected owner** — from commit/PR authorship.
- **Confidence bar** — higher *because* memory corroborates the code.
- **📄 Live incident canvas** — click it: Culprit has opened a Slack Canvas with the whole
  incident (symptom, hypothesis, evidence, owner). It's a durable doc, not a card that scrolls away.
> "Notice it says *hypothesis* — every claim links to a source it actually found, and it
> remembers what your team already solved."

### 1:30 — One-click issue (25s)
Click **📝 Create GitHub issue**. Culprit posts **✅ Filed #123**. Open the link —
a clean, pre-written issue with title, body, and labels.
> "From a one-line Slack message to a filed, triaged issue — without leaving the thread."

### 1:55 — Close the loop, and it gets smarter (30s)
Click **✅ Mark resolved**. A modal asks *what actually fixed it* and whether the
hypothesis was right. Submit → Culprit replies **🧠 Logged to memory** and appends a
**✅ Resolved** section to the incident canvas.
> "That fix is now part of the org's memory. The next time this rhymes, Culprit recalls
> it — it compounds with every incident."

To prove the compounding without Slack, run `npm run verify:learning`: a paraphrased
report matches **nothing**, Culprit learns the incident, and the same report then recalls
the exact fix and who applied it.

### 2:25 — The MCP story (35s)
Show the architecture diagram. 
> "Culprit is built on MCP on **both** sides. It **consumes** the GitHub MCP server
> for evidence — and it **ships its own** MCP server, so any other agent can call
> `triage_incident`."
Optionally run `npm run mcp` and show the tool being listed/called.

### 3:00 — Close (20s)
> "It runs anywhere over Socket Mode, reads over MCP, writes only when a human clicks —
> and it remembers. Honest, evidence-backed triage that compounds. That's Culprit."

---

**Backup if the live Slack connection is flaky:** run `npm run demo:mcp` — an external
MCP client calls Culprit's `triage_incident` over stdio and prints the full verdict.
This is a Slack-independent, recordable artifact that proves brain + evidence + the
served MCP server end-to-end.

**Backup if GitHub is rate-limited / offline:** pre-record the verdict card, or point
`GITHUB_DEFAULT_REPO` at a small public repo with a known recent change.
