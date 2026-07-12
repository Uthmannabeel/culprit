import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

/**
 * Demonstrates that Culprit is an MCP-native *service*, not just a Slack app:
 * an independent agent connects to Culprit's MCP server over stdio, discovers
 * its tools, and calls `triage_incident` — exactly as any other MCP client
 * (another assistant, an automation) would. This is the "consume on one side,
 * SERVE on the other" story, proven end-to-end.
 *
 * Run: npm run demo:mcp
 */
async function main(): Promise<void> {
  const isWin = process.platform === "win32";
  const transport = new StdioClientTransport({
    command: isWin ? "cmd" : "npx",
    args: isWin ? ["/c", "npx", "tsx", "src/server/triageMcpServer.ts"] : ["tsx", "src/server/triageMcpServer.ts"],
    env: { ...process.env } as Record<string, string>,
  });

  const client = new Client({ name: "external-agent", version: "0.1.0" }, { capabilities: {} });
  await client.connect(transport);

  console.log("→ Connected to Culprit's MCP server. Discovering tools…\n");
  const { tools } = await client.listTools();
  for (const t of tools) console.log(`   • ${t.name} — ${t.description ?? ""}`);

  console.log("\n→ Calling triage_incident over MCP…\n");
  const result = await client.callTool({
    name: "triage_incident",
    arguments: {
      report: "checkout is throwing 500s since this morning",
      repo: "Uthmannabeel/culprit-demo-shop",
    },
  });

  const content = result.content as Array<{ type: string; text?: string }>;
  for (const block of content) {
    if (block.type === "text" && block.text) console.log(block.text);
  }

  await client.close();
}

main().catch((err) => {
  console.error("Demo failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
