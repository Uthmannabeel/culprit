# Culprit — Architecture

```mermaid
flowchart TD
    user["👤 Teammate in Slack<br/>'@Culprit checkout is 500ing repo:acme/store'"]

    subgraph slack["Slack"]
      mention["app_mention / DM event"]
      card["Block Kit verdict card<br/>+ 'Create GitHub issue' button"]
    end

    subgraph culprit["Culprit agent (Node / TypeScript, Socket Mode)"]
      handlers["Slack handlers<br/>(parse report + repo)"]
      brain["Triage brain<br/>(Claude agentic tool-use loop)"]
      bridge["GitHub MCP client bridge"]
      issuer["GitHub REST issue writer"]
    end

    subgraph external["External services"]
      claude["Claude<br/>claude-opus-4-8<br/>adaptive thinking"]
      ghmcp["GitHub MCP server<br/>(commits / PRs / issues / files)"]
      ghrest["GitHub REST API<br/>(create issue)"]
    end

    user -->|"@mention / DM"| mention --> handlers --> brain
    brain <-->|"messages + tool calls"| claude
    brain -->|"tool calls (read-only)"| bridge <-->|"MCP"| ghmcp
    brain -->|"structured verdict"| card --> user
    card -->|"button click"| issuer -->|"POST /issues"| ghrest
    ghrest -->|"issue URL"| card

    %% Culprit also EXPOSES its own MCP server
    extagent["🤖 Any external agent"] -->|"MCP: triage_incident"| mcpserver["Culprit MCP server"]
    mcpserver --> brain
```

## The agentic loop (how a verdict is formed)

```mermaid
sequenceDiagram
    participant U as User (Slack)
    participant B as Triage brain
    participant C as Claude
    participant G as GitHub MCP

    U->>B: incident report + repo
    loop until submit_triage (bounded by TRIAGE_MAX_STEPS)
        B->>C: messages + tools (GitHub MCP + submit_triage)
        C-->>B: tool_use: search commits / list PRs / read file
        B->>G: execute MCP tool call
        G-->>B: real evidence
        B->>C: tool_result
    end
    C-->>B: submit_triage(verdict)
    B-->>U: Block Kit card (hypothesis, owner, evidence, draft issue)
```

## Design decisions

- **Socket Mode** — outbound WebSocket only, so Culprit runs anywhere (incl. behind
  a corporate firewall) with no public URL or inbound rule.
- **MCP on both sides** — consumes the GitHub MCP server for evidence; exposes its
  own `triage_incident` MCP tool so other agents can reuse Culprit.
- **Read over MCP, write over REST** — the autonomous loop is read-only; filing an
  issue is a deterministic, explicit, human-clicked action.
- **Structured finalizer (`submit_triage`)** — guarantees a validated, render-ready
  verdict instead of free-form prose, and bounds the loop.
- **Honest scope** — every claim cites evidence the agent actually retrieved;
  confidence is calibrated to how much evidence was found.
