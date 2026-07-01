import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../config.js";
import { IncidentMemory } from "../memory/store.js";
import type { IncidentRecord } from "../memory/types.js";

/**
 * Proves the learning loop end-to-end (no Slack needed): Culprit remembers a
 * brand-new resolved incident, then recalls it from a *paraphrased* report —
 * showing the knowledge compounds. Uses a throwaway DB so the seed is untouched.
 *
 * Run: npm run verify:learning
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const dbPath = join(tmpdir(), "culprit-learning-demo.json");
  await rm(dbPath, { force: true });
  await rm(`${dbPath}.cache.json`, { force: true });

  const memory = new IncidentMemory(config, dbPath);
  await memory.load();

  const fresh: IncidentRecord = {
    id: "inc-demo-rate-limit",
    symptom: "API returning 429 Too Many Requests for everyone after the new release",
    rootCause: "A new client retried aggressively with no backoff, tripping the global rate limiter.",
    resolution: "Added exponential backoff + jitter to the client and raised the limiter burst.",
    resolvedBy: "sam",
    links: ["https://github.com/acme/store/pull/777"],
    repo: "acme/store",
    createdAt: "2026-06-30T00:00:00Z",
    hypothesisWasCorrect: true,
    embedding: null,
  };

  console.log("Before learning — recalling a paraphrase of an incident Culprit has never seen:");
  await show(memory, "users are getting rate limited, lots of 429s since the deploy");

  console.log(`\nTeaching Culprit: "${fresh.symptom}"\n   fix: ${fresh.resolution} (${fresh.resolvedBy})\n`);
  await memory.remember(fresh);

  console.log("After learning — same paraphrased report:");
  await show(memory, "users are getting rate limited, lots of 429s since the deploy");

  await rm(dbPath, { force: true });
  await rm(`${dbPath}.cache.json`, { force: true });
}

async function show(memory: IncidentMemory, query: string): Promise<void> {
  const hits = await memory.recall(query);
  if (hits.length === 0) {
    console.log(`   ❓ "${query}" → (no confident match)`);
    return;
  }
  for (const h of hits) {
    console.log(`   ✅ "${query}" → ${(h.score * 100).toFixed(0)}% ${h.record.id}: ${h.record.resolution} (${h.record.resolvedBy})`);
  }
}

main().catch((err) => {
  console.error("Verify failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
