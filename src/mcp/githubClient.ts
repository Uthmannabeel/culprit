import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { AppConfig } from "../config.js";

/**
 * A minimal description of an MCP tool, shaped so it can be handed straight to
 * Claude's `tools` parameter.
 */
export interface BridgedTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

/**
 * Connects to the GitHub MCP server and bridges its tools into our agentic
 * loop. We consume MCP here (the "context source"); elsewhere we expose our own
 * MCP server — consume on one side, ship on the other.
 */
export class GitHubMcpBridge {
  private client: Client | null = null;
  private tools: BridgedTool[] = [];

  constructor(private readonly config: AppConfig) {}

  /** Open the connection and cache the available tool list. */
  async connect(): Promise<void> {
    const client = new Client(
      { name: "slack-triage", version: "0.1.0" },
      { capabilities: {} },
    );

    if (this.config.GITHUB_MCP_MODE === "remote") {
      const transport = new StreamableHTTPClientTransport(new URL(this.config.GITHUB_MCP_URL), {
        requestInit: {
          headers: { Authorization: `Bearer ${this.config.GITHUB_TOKEN}` },
        },
      });
      await client.connect(transport);
    } else {
      // Local mode: run the official GitHub MCP server over stdio via Docker.
      const transport = new StdioClientTransport({
        command: "docker",
        args: ["run", "-i", "--rm", "-e", "GITHUB_PERSONAL_ACCESS_TOKEN", "ghcr.io/github/github-mcp-server"],
        env: { GITHUB_PERSONAL_ACCESS_TOKEN: this.config.GITHUB_TOKEN },
      });
      await client.connect(transport);
    }

    this.client = client;
    const listed = await client.listTools();
    this.tools = listed.tools.map((t) => ({
      name: t.name,
      description: t.description ?? "",
      input_schema: (t.inputSchema as Record<string, unknown>) ?? { type: "object", properties: {} },
    }));
  }

  /** Tools available for Claude to call, as Anthropic tool definitions. */
  getTools(): BridgedTool[] {
    return this.tools;
  }

  /**
   * Execute one MCP tool call and return a text result for Claude.
   * Errors are returned (not thrown) so the agentic loop can recover.
   */
  async callTool(name: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }> {
    if (!this.client) throw new Error("GitHubMcpBridge.connect() must be called first");
    try {
      const result = await this.client.callTool({ name, arguments: args });
      const text = extractText(result.content);
      return { text: text || "(tool returned no textual content)", isError: Boolean(result.isError) };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { text: `Tool "${name}" failed: ${message}`, isError: true };
    }
  }

  async close(): Promise<void> {
    await this.client?.close();
    this.client = null;
  }
}

/** Flatten MCP content blocks into a single text string for the model. */
export function extractText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (block && typeof block === "object" && "type" in block) {
      const b = block as { type: string; text?: string };
      if (b.type === "text" && typeof b.text === "string") parts.push(b.text);
      else parts.push(JSON.stringify(block));
    }
  }
  return parts.join("\n");
}
