import { createServer, type Server } from "node:http";

/**
 * Minimal liveness endpoint — an incident tool should be observable itself.
 * Opt-in via HEALTH_PORT (Socket Mode needs no inbound port otherwise).
 */
export function buildHealthPayload(startedAtMs: number, nowMs: number = Date.now()): Record<string, unknown> {
  return {
    status: "ok",
    service: "culprit",
    uptimeSeconds: Math.max(0, Math.round((nowMs - startedAtMs) / 1000)),
  };
}

export function startHealthServer(port: number): Server {
  const startedAt = Date.now();
  const server = createServer((_req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(buildHealthPayload(startedAt)));
  });
  // A liveness endpoint must never take the bot down: an unhandled 'error'
  // event (e.g. EADDRINUSE after a crashed prior instance) would throw.
  server.on("error", (err) => {
    console.error("[health] server error:", err instanceof Error ? err.message : err);
  });
  server.listen(port);
  return server;
}
