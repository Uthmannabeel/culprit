import { App, LogLevel } from "@slack/bolt";
import type { AppConfig } from "./config.js";
import { registerHandlers } from "./slack/handlers.js";

/**
 * Build the Bolt app in Socket Mode. Socket Mode uses an outbound WebSocket, so
 * Triage needs no public URL or inbound firewall rule — it runs fine behind a
 * corporate network.
 */
export function createApp(config: AppConfig): App {
  const app = new App({
    token: config.SLACK_BOT_TOKEN,
    appToken: config.SLACK_APP_TOKEN,
    socketMode: true,
    logLevel: config.LOG_LEVEL === "debug" ? LogLevel.DEBUG : LogLevel.INFO,
  });

  registerHandlers(app, config);
  return app;
}
