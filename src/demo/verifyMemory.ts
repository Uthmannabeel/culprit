import { loadConfig } from "../config.js";
import { IncidentMemory } from "../memory/store.js";
import { embedText } from "../memory/embeddings.js";

/**
 * Proves incident recall works on this network: loads the seeded memory and
 * runs a few queries, printing the ranked matches and how each was scored
 * (embedding vs lexical fallback). Useful for sanity-checking + tuning
 * MEMORY_MIN_SCORE before a demo.
 *
 * Run: npm run verify:memory
 */
const QUERIES = [
  "checkout is throwing 500s since this morning",
  "people can't log in, it keeps redirecting",
  "the homepage banner is the wrong colour",
];

async function main(): Promise<void> {
  const config = loadConfig();

  // Probe the embedding model directly so failures are visible (not silently
  // masked by the lexical fallback).
  try {
    const vec = await embedText(config, "checkout is returning 500 errors");
    console.log(`Embedding model ${config.EMBEDDING_MODEL}: OK (dim ${vec.length})\n`);
  } catch (err) {
    console.log(`Embedding model ${config.EMBEDDING_MODEL}: FAILED — ${err instanceof Error ? err.message : String(err)}`);
    console.log("(recall will use the lexical fallback)\n");
  }

  const memory = new IncidentMemory(config);
  await memory.load();
  console.log(`Loaded ${memory.size()} past incidents from ${config.INCIDENTS_DB_PATH}\n`);

  for (const q of QUERIES) {
    console.log(`❓ "${q}"`);
    const hits = await memory.recall(q);
    if (hits.length === 0) {
      console.log("   (no confident match)\n");
      continue;
    }
    for (const h of hits) {
      console.log(`   ${(h.score * 100).toFixed(0)}% [${h.method}] ${h.record.id}`);
      console.log(`        ${h.record.symptom}`);
      if (h.record.resolution) console.log(`        fix: ${h.record.resolution} (${h.record.resolvedBy ?? "?"})`);
    }
    console.log("");
  }
}

main().catch((err) => {
  console.error("Verify failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
