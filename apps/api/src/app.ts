/**
 * app.ts
 *
 * WHAT: Builds the Fastify server and its routes, but does NOT start listening.
 *       Keeping "build" and "start" separate means tests can try the routes
 *       without opening a real network port.
 */
import Fastify from "fastify";
import { formatPeso } from "@split/core";

export function buildApp(options: { logger?: boolean } = {}) {
  const app = Fastify({ logger: options.logger ?? false });

  // A simple "is the server alive?" check. The sample proves the API can use @split/core.
  app.get("/health", async () => ({ status: "ok", sample: formatPeso(123456) }));

  return app;
}