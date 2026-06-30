import { loadConfig } from "../config.js";

/** List models this Gemini key can use, and which support embedContent. */
async function main(): Promise<void> {
  const config = loadConfig();
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${config.GEMINI_API_KEY}&pageSize=200`,
  );
  if (!res.ok) throw new Error(`ListModels failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as {
    models?: Array<{ name: string; supportedGenerationMethods?: string[] }>;
  };
  const embed = (data.models ?? []).filter((m) => m.supportedGenerationMethods?.includes("embedContent"));
  console.log("Models supporting embedContent:");
  for (const m of embed) console.log(`  ${m.name}`);
  if (embed.length === 0) console.log("  (none — this key has no embedding access)");
}

main().catch((err) => {
  console.error("Failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
