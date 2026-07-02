import { describe, expect, test } from "vitest";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  EvidenceHub,
  parseEvidenceServers,
  parseHubArgs,
  type EvidenceServerConfig,
} from "./evidenceHub.js";

describe("parseEvidenceServers", () => {
  test("parses name=url pairs and picks up per-source auth from env", () => {
    const servers = parseEvidenceServers("sentry=https://mcp.sentry.dev/mcp, logs=https://logs.internal/mcp", {
      EVIDENCE_MCP_AUTH_SENTRY: "tok-123",
    });
    expect(servers).toEqual([
      { name: "sentry", url: "https://mcp.sentry.dev/mcp", authToken: "tok-123" },
      { name: "logs", url: "https://logs.internal/mcp" },
    ]);
  });

  test("drops malformed entries instead of failing the whole config", () => {
    const servers = parseEvidenceServers("good=https://x/mcp, noequals, bad name=https://y, ftp=ftp://z", {});
    expect(servers).toEqual([{ name: "good", url: "https://x/mcp" }]);
  });

  test("empty or unset config means no sources", () => {
    expect(parseEvidenceServers(undefined)).toEqual([]);
    expect(parseEvidenceServers("  ")).toEqual([]);
  });
});

describe("parseHubArgs", () => {
  test("parses a JSON object string, and degrades everything else to {}", () => {
    expect(parseHubArgs('{"query":"checkout 500"}')).toEqual({ query: "checkout 500" });
    expect(parseHubArgs("not json")).toEqual({});
    expect(parseHubArgs('["array"]')).toEqual({});
    expect(parseHubArgs(undefined)).toEqual({});
    expect(parseHubArgs("")).toEqual({});
  });
});

/** A real MCP server (in-memory transport) exposing one log-search tool. */
async function makeTestClient(): Promise<Client> {
  const server = new McpServer({ name: "test-logs", version: "0.0.1" });
  server.tool(
    "search_logs",
    "Search application logs.",
    { query: z.string() },
    async ({ query }) => ({
      content: [{ type: "text", text: `3 log lines matching "${query}": payment client not configured` }],
    }),
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test", version: "0.0.1" }, { capabilities: {} });
  await client.connect(clientTransport);
  return client;
}

const LOGS: EvidenceServerConfig = { name: "logs", url: "https://unused.invalid/mcp" };
const DOWN: EvidenceServerConfig = { name: "down", url: "https://unused.invalid/mcp" };

describe("EvidenceHub (against a real in-memory MCP server)", () => {
  test("catalogs connected sources and calls their tools", async () => {
    const hub = new EvidenceHub([LOGS], async () => makeTestClient());

    const catalog = await hub.sources();
    expect(catalog).toEqual([
      { source: "logs", tools: [{ name: "search_logs", description: "Search application logs." }] },
    ]);

    const text = await hub.call("logs", "search_logs", { query: "checkout 500" });
    expect(text).toContain('matching "checkout 500"');
    expect(text).toContain("payment client not configured");

    await hub.close();
  });

  test("a failing source is skipped — it never breaks the others", async () => {
    const hub = new EvidenceHub([DOWN, LOGS], async (server) => {
      if (server.name === "down") throw new Error("connect ECONNREFUSED");
      return makeTestClient();
    });

    const catalog = await hub.sources();
    expect(catalog.map((c) => c.source)).toEqual(["logs"]);
    expect(await hub.call("logs", "search_logs", { query: "x" })).toContain("log lines");

    await hub.close();
  });

  test("unknown sources and failing tools come back as text, not throws", async () => {
    const hub = new EvidenceHub([LOGS], async () => makeTestClient());

    expect(await hub.call("nope", "search_logs", {})).toContain('Unknown evidence source "nope"');
    // The SDK surfaces unknown tools as an error result; either way the model
    // receives explanatory text, never an exception.
    expect(await hub.call("logs", "no_such_tool", {})).toMatch(/no_such_tool|failed/);

    await hub.close();
  });

  test("no configured sources means the hub is disabled", () => {
    expect(new EvidenceHub([]).enabled).toBe(false);
    expect(new EvidenceHub([LOGS]).enabled).toBe(true);
  });
});
