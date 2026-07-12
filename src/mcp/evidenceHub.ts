import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { extractText } from "./githubClient.js";

/**
 * The Evidence Hub: ANY MCP server becomes a Culprit evidence source via
 * config, no vendor integration code. `EVIDENCE_MCP_SERVERS` lists servers as
 * `name=https://url` pairs; a Sentry/Grafana/logs MCP server's tools then join
 * the same bounded agentic loop as memory and GitHub. This is how the
 * "evidence is GitHub-shaped" limitation dissolves — the MCP ecosystem is the
 * integration surface.
 *
 * Failure discipline: every source is best-effort. A misconfigured or down
 * server is logged and skipped — it must never break a triage.
 */

export interface EvidenceServerConfig {
  name: string;
  url: string;
  authToken?: string;
}

/**
 * Parse `EVIDENCE_MCP_SERVERS` ("sentry=https://mcp.sentry.dev/mcp, logs=…").
 * Per-source bearer auth comes from `EVIDENCE_MCP_AUTH_<NAME>` env vars so
 * tokens never live in the server list itself. Malformed entries are dropped.
 */
export function parseEvidenceServers(
  raw: string | undefined,
  env: Record<string, string | undefined> = process.env,
): EvidenceServerConfig[] {
  return (raw ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .flatMap((entry) => {
      const split = entry.indexOf("=");
      if (split <= 0) return [];
      const name = entry.slice(0, split).trim().toLowerCase();
      const url = entry.slice(split + 1).trim();
      if (!/^[a-z0-9_-]+$/.test(name) || !/^https?:\/\//.test(url)) return [];
      const authToken = env[`EVIDENCE_MCP_AUTH_${name.toUpperCase().replace(/-/g, "_")}`];
      return [{ name, url, ...(authToken ? { authToken } : {}) }];
    });
}

export interface EvidenceToolInfo {
  name: string;
  description: string;
}

export interface EvidenceSourceCatalog {
  source: string;
  tools: EvidenceToolInfo[];
}

/** Builds a connected MCP client for one source. Injectable for tests. */
export type EvidenceClientFactory = (server: EvidenceServerConfig) => Promise<Client>;

async function connectHttpClient(server: EvidenceServerConfig): Promise<Client> {
  const client = new Client({ name: "culprit-evidence-hub", version: "0.1.0" }, { capabilities: {} });
  const transport = new StreamableHTTPClientTransport(new URL(server.url), {
    requestInit: server.authToken ? { headers: { Authorization: `Bearer ${server.authToken}` } } : undefined,
  });
  await client.connect(transport);
  return client;
}

export class EvidenceHub {
  private readonly clients = new Map<string, Client>();
  private catalog: EvidenceSourceCatalog[] = [];
  private connecting: Promise<void> | null = null;

  constructor(
    private readonly servers: EvidenceServerConfig[],
    private readonly factory: EvidenceClientFactory = connectHttpClient,
  ) {}

  /** Whether any sources are configured — gates tool registration in the brains. */
  get enabled(): boolean {
    return this.servers.length > 0;
  }

  /**
   * Connect every configured source, skipping (and logging) any that fail.
   * Memoized as a promise: both brains fire a round's tool calls with
   * Promise.all, so two concurrent hub calls must share ONE connect — a flag
   * would let the second caller through with a half-empty catalog.
   */
  private connect(): Promise<void> {
    this.connecting ??= this.doConnect();
    return this.connecting;
  }

  private async doConnect(): Promise<void> {
    // Connect sources concurrently — the first hub call pays the slowest
    // handshake, not the sum of all of them.
    const results = await Promise.allSettled(
      this.servers.map(async (server) => {
        const client = await this.factory(server);
        const listed = await client.listTools();
        return { server, client, listed };
      }),
    );
    results.forEach((result, i) => {
      const server = this.servers[i];
      if (!server) return;
      if (result.status === "rejected") {
        const reason = result.reason instanceof Error ? result.reason.message : result.reason;
        console.error(`[evidence-hub] source "${server.name}" unavailable:`, reason);
        return;
      }
      this.clients.set(server.name, result.value.client);
      this.catalog.push({
        source: server.name,
        tools: result.value.listed.tools.map((t) => ({ name: t.name, description: (t.description ?? "").slice(0, 300) })),
      });
    });
  }

  /** The catalog the model sees: which sources exist and what they can do. */
  async sources(): Promise<EvidenceSourceCatalog[]> {
    await this.connect();
    return this.catalog;
  }

  /**
   * Call one tool on one source. Failures come back with `isError: true` (not
   * throws) so the dispatcher can map them to the `error` evidence status —
   * a failed check must never reach the model looking like a clean result.
   */
  async call(source: string, tool: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }> {
    await this.connect();
    const client = this.clients.get(source);
    if (!client) {
      const available = this.catalog.map((c) => c.source).join(", ") || "none connected";
      return { text: `Unknown evidence source "${source}". Available sources: ${available}.`, isError: true };
    }
    try {
      const result = await client.callTool({ name: tool, arguments: args });
      const text = extractText(result.content);
      return { text: text || "(tool returned no textual content)", isError: Boolean(result.isError) };
    } catch (err) {
      return {
        text: `Evidence source "${source}" tool "${tool}" failed: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    }
  }

  async close(): Promise<void> {
    for (const client of this.clients.values()) {
      await client.close().catch(() => undefined);
    }
    this.clients.clear();
    this.catalog = [];
    this.connecting = null;
  }
}

/** Tool names/descriptions shared by both brains. */
export const HUB_LIST_TOOL_NAME = "list_evidence_sources";
export const HUB_LIST_TOOL_DESCRIPTION =
  "List the additional evidence sources connected to this workspace (e.g. error trackers, log or metric search) and the tools each offers. Check this early — runtime signals often live outside GitHub.";
export const HUB_QUERY_TOOL_NAME = "query_evidence_source";
export const HUB_QUERY_TOOL_DESCRIPTION =
  "Call a tool on a connected evidence source (see list_evidence_sources for what exists). Pass the source name, the tool name, and the tool's arguments as a JSON object string.";

/** Parse the model-provided argsJson defensively — bad JSON becomes {}. */
export function parseHubArgs(argsJson: unknown): Record<string, unknown> {
  if (typeof argsJson !== "string" || argsJson.trim() === "") return {};
  try {
    const parsed = JSON.parse(argsJson) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
