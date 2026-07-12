import { loadConfig } from "./config.js";
import { createApp } from "./app.js";
import { startHealthServer } from "./server/health.js";

/** Entry point: validate config, start the Socket Mode app. */
async function main(): Promise<void> {
  const config = loadConfig();
  const app = createApp(config);
  await app.start();
  if (config.HEALTH_PORT) {
    startHealthServer(config.HEALTH_PORT);
    console.log(`Health endpoint on http://localhost:${config.HEALTH_PORT}/`);
  }
  console.log("⚡ Culprit is running (Socket Mode). Mention it in a channel or DM it an incident.");
}

main().catch((err) => {
  console.error("Fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
