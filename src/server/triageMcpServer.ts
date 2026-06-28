import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadConfig } from "../config.js";
import { runTriage } from "../triage/brain.js";

/**
 * Triage-as-an-MCP-server. We consume the GitHub MCP server on one side and
 * expose Triage's own capability on the other, so any MCP-speaking agent
 * (another assistant, an automation, a different Slack app) can call it.
 */
async function main(): Promise<void> {
  const config = loadConfig();

  const server = new McpServer({ name: "triage", version: "0.1.0" });

  server.tool(
    "triage_incident",
    "Investigate an incident report against a GitHub repo and return a root-cause hypothesis, suspected owner, evidence, and a draft issue.",
    {
      report: z.string().describe("The incident report / symptom description."),
      repo: z.string().optional().describe("owner/repo to investigate. Defaults to the server's configured repo."),
    },
    async ({ report, repo }) => {
      try {
        const result = await runTriage(config, { report, repo });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Triage failed: ${message}` }], isError: true };
      }
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // eslint-disable-next-line no-console
  console.error("Triage MCP server running on stdio.");
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
