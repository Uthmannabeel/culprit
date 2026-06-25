# Culprit — 3-minute demo script

**Goal:** show the full loop — a plain incident report in Slack becomes a triaged,
evidence-backed verdict and a filed GitHub issue — and make the MCP story explicit.

**Setup before recording:** `npm run dev` running; bot invited to a demo channel;
`GITHUB_DEFAULT_REPO` pointing at a repo that has a real, recent breaking change
(seed one if needed — e.g. a commit/PR that removes an env-var read).

---

### 0:00 — The problem (20s)
> "When something breaks, the first 20 minutes are spent figuring out *what changed*
> and *who owns it*. Culprit does that first pass for you — inside Slack."

### 0:20 — Report an incident (25s)
Type in the channel:
> `@Culprit checkout is throwing 500s since this morning repo:acme/store`

Culprit replies **🔍 Investigating…** and the status updates live
(*"Checking GitHub: search_pull_requests"*) — point out it's **gathering real
evidence over MCP**, not guessing.

### 0:45 — The verdict (45s)
The card lands. Walk through it:
- **Likely cause (hypothesis)** — names the suspect change.
- **Evidence** — each line links to a **real** commit / PR / file it pulled.
- **Suspected owner** — from commit/PR authorship.
- **Confidence bar** — calibrated to the evidence.
> "Notice it says *hypothesis* — every claim links to a source it actually found."

### 1:30 — One-click issue (25s)
Click **📝 Create GitHub issue**. Culprit posts **✅ Filed #123**. Open the link —
a clean, pre-written issue with title, body, and labels.
> "From a one-line Slack message to a filed, triaged issue — without leaving the thread."

### 1:55 — The MCP story (35s)
Show the architecture diagram. 
> "Culprit is built on MCP on **both** sides. It **consumes** the GitHub MCP server
> for evidence — and it **ships its own** MCP server, so any other agent can call
> `triage_incident`."
Optionally run `npm run mcp` and show the tool being listed/called.

### 2:30 — Close (20s)
> "Socket Mode means it runs anywhere with no public URL. It reads over MCP and only
> writes when a human clicks. Honest, evidence-backed triage — that's Culprit."

---

**Backup if GitHub is rate-limited / offline:** pre-record the verdict card, or point
`GITHUB_DEFAULT_REPO` at a small public repo with a known recent change.
