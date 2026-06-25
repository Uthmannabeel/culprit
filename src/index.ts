import { loadConfig } from "./config.js";
import { createApp } from "./app.js";

/** Entry point: validate config, start the Socket Mode app. */
async function main(): Promise<void> {
  const config = loadConfig();
  const app = createApp(config);
  await app.start();
  // eslint-disable-next-line no-console
  console.log("⚡ Culprit is running (Socket Mode). Mention it in a channel or DM it an incident.");
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
