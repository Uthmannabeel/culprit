# Culprit — Architecture

```mermaid
flowchart TD
    user["👤 Teammate in Slack<br/>'@Culprit checkout is 500ing repo:acme/store'"]

    subgraph slack["Slack"]
      mention["app_mention / DM /<br/>assistant panel"]
      card["Verdict card (Block Kit)<br/>prior incident · cause · evidence · owner"]
      canvas["Living incident canvas<br/>(auto-created, resolution appended)"]
      modal["'Log resolution' modal"]
    end

    subgraph culprit["Culprit agent (Node / TypeScript, Socket Mode)"]
      handlers["Slack handlers<br/>(parse report + repo, in-flight guard)"]
      brain["Triage brain — pluggable<br/>(bounded agentic tool-use loop)"]
      memory[("Incident memory<br/>embeddings + recall / remember")]
      bridge["GitHub MCP client bridge"]
      evidence["GitHub REST evidence<br/>(commits · PRs · issues · code search)"]
      hub["Evidence Hub<br/>(EVIDENCE_MCP_SERVERS, config-only)"]
      issuer["GitHub REST issue writer<br/>(repo allowlist)"]
    end

    subgraph external["External services"]
      llm["Gemini 2.5 Flash (free tier)<br/>or Claude Opus 4.8"]
      ghmcp["GitHub MCP server"]
      ghrest["GitHub REST API"]
      anymcp["ANY MCP server<br/>(error tracker · logs · metrics)"]
    end

    user --> mention --> handlers --> brain
    brain <-->|"messages + tool calls"| llm
    brain -->|"1️⃣ recall_incident_memory"| memory
    brain -->|"2️⃣ read-only evidence"| bridge <-->|"MCP"| ghmcp
    brain -->|"2️⃣ read-only evidence"| evidence --> ghrest
    brain -->|"2️⃣ read-only evidence"| hub <-->|"MCP"| anymcp
    brain -->|"validated verdict + prior incidents"| card --> user
    handlers --> canvas
    card -->|"Create GitHub issue (human click)"| issuer --> ghrest
    card -->|"Log resolution (human click)"| modal -->|"what actually fixed it"| memory
    modal -->|"Resolution section"| canvas

    %% Culprit also SERVES its own MCP tool
    extagent["🤖 Any external agent"] -->|"MCP: triage_incident"| mcpserver["Culprit MCP server (stdio)"]
    mcpserver --> brain
```

## The compounding loop (what makes Culprit different)

```mermaid
sequenceDiagram
    participant U as Reporter (Slack)
    participant B as Triage brain
    participant M as Incident memory
    participant G as GitHub (MCP / REST)
    participant R as Responder

    U->>B: "checkout is throwing 500s"
    B->>M: recall_incident_memory(symptom)
    M-->>B: similar past incident + what fixed it + who
    loop bounded agentic loop (TRIAGE_MAX_STEPS)
        B->>G: merged PRs / commits / issues / code search
        G-->>B: real evidence (read-only)
    end
    B-->>U: verdict card — prior match, causal hypothesis,<br/>linked evidence, suggested owner, draft issue
    R->>B: "Create GitHub issue" (click)
    B->>G: POST /issues (allowlisted repo)
    R->>B: "Log resolution" (click)
    B->>M: remember(symptom, actual fix, was hypothesis right?)
    Note over M: Next similar incident recalls THIS resolution.<br/>Culprit gets smarter with every incident.
```

## Design decisions

- **Memory first, then git.** The strongest triage lead is "we solved this before" —
  recall runs before any code archaeology, and the verdict's confidence is raised only
  when memory and evidence corroborate each other. Resolved incidents are embedded
  (`gemini-embedding-001`) with a lexical fallback so recall degrades, never fails.
- **The learning loop closes in Slack.** "Log resolution" captures what *actually* fixed
  the incident and whether the hypothesis was right — so confidence is earned from
  outcomes, not guessed. Institutional knowledge stops evaporating in threads.
- **MCP on both sides.** Culprit consumes the GitHub MCP server as a read-only evidence
  source *and* serves its own `triage_incident` MCP tool, so any other agent can reuse it.
- **Read over MCP, write over REST — with an allowlist.** The autonomous loop is
  read-only; filing an issue is an explicit human click, restricted to allowlisted repos
  (no confused-deputy).
- **Pluggable brain.** `LLM_PROVIDER` switches between the free-tier Gemini path
  (evidence over GitHub REST) and Claude (evidence over the GitHub MCP server) — same
  prompt, same structured `submit_triage` finalizer, same memory.
- **Socket Mode** — outbound WebSocket only; runs behind a corporate firewall with no
  public URL.
- **Output designed to industry benchmark.** Categorical confidence (never percentage
  bars), one severity signal, numbered evidence links verifiable in under 30 seconds,
  and a living Canvas as the durable incident record — following the conventions of
  incident.io, Rootly, Datadog, and Slack's own Block Kit guidance.
- **Honest scope.** Every claim cites a source Culprit actually retrieved; the card says
  "hypothesis, not a verdict" and means it.
