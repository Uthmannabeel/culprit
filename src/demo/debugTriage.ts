import { loadConfig } from "../config.js";
import { runTriage } from "../triage/brain.js";

/**
 * Diagnostic: run one triage in-process and surface the FULL error including
 * its cause — spawned processes (demo:mcp) can mask provider errors like
 * free-tier quota exhaustion as a bare "fetch failed".
 *
 * Run: npm run debug:triage
 */
async function main(): Promise<void> {
  const config = loadConfig();
  try {
    const result = await runTriage(config, {
      report: "checkout is throwing 500s since this morning",
      repo: "Uthmannabeel/culprit-demo-shop",
    });
    console.log("OK:", result.summary, "| confidence", result.confidence);
  } catch (err) {
    const e = err as Error & { cause?: unknown };
    console.error("ERROR:", e.message);
    if (e.cause) console.error("CAUSE:", e.cause);
    if (e.stack) console.error(e.stack.split("\n").slice(0, 6).join("\n"));
    process.exit(1);
  }
}

main();
