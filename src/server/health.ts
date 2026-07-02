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
  server.listen(port);
  return server;
}
