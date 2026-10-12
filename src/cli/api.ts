import { serve } from "@hono/node-server";
import { createApp } from "../api/app.js";
import { liveRankingSource } from "../api/live-source.js";
import { pool } from "../db.js";

const DEFAULT_PORT = 8787;

// `localhost` resolves to either of these depending on the client, so listen on both.
const HOSTS = ["127.0.0.1", "::1"];

function log(message: string) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

function apiPort(): number {
  const raw = process.env.API_PORT;
  if (!raw) return DEFAULT_PORT;

  const port = Number(raw);
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new Error(`API_PORT must be a port number, got "${raw}".`);
  }
  return port;
}

function main() {
  const port = apiPort();
  const app = createApp(liveRankingSource);

  const servers = HOSTS.map((hostname) =>
    serve({ fetch: app.fetch, hostname, port }).on("error", (error) => {
      console.error(`can't listen on ${hostname}:${port}: ${error.message}`);
      process.exit(1);
    }),
  );

  log(`api listening on http://localhost:${port}`);

  const shutdown = async (signal: string) => {
    log(`${signal} received — shutting down`);
    await Promise.all(
      servers.map((server) => new Promise((resolve) => server.close(() => resolve(undefined)))),
    );
    await pool.end();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

try {
  main();
} catch (error: unknown) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
