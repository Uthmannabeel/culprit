import { App, LogLevel } from "@slack/bolt";
import type { AppConfig } from "./config.js";
import { registerHandlers } from "./slack/handlers.js";

/**
 * Build the Bolt app in Socket Mode. Socket Mode uses an outbound WebSocket, so
 * Triage needs no public URL or inbound firewall rule — it runs fine behind a
 * corporate network.
 */
const BOLT_LOG_LEVEL: Record<AppConfig["LOG_LEVEL"], LogLevel> = {
  debug: LogLevel.DEBUG,
  info: LogLevel.INFO,
  warn: LogLevel.WARN,
  error: LogLevel.ERROR,
};

export function createApp(config: AppConfig): App {
  const app = new App({
    token: config.SLACK_BOT_TOKEN,
    appToken: config.SLACK_APP_TOKEN,
    socketMode: true,
    logLevel: BOLT_LOG_LEVEL[config.LOG_LEVEL],
  });

  registerHandlers(app, config);
  return app;
}
