/**
 * app.ts
 *
 * WHAT: Builds the Fastify server and its routes, but does NOT start listening.
 *       Keeping "build" and "start" separate means tests can try the routes
 *       without opening a real network port.
 */
import Fastify from "fastify";
import { formatPeso } from "@split/core";
import type { Sql } from "./db";
import { registerGroupRoutes } from "./routes/groups";
import { registerExpenseRoutes } from "./routes/expenses";

export function buildApp(options: { logger?: boolean; sql?: Sql } = {}) {
  const app = Fastify({ logger: options.logger ?? false });
  const { sql } = options;

  // A simple "is the server alive?" check. The sample proves the API can use @split/core.
  app.get("/health", async () => ({ status: "ok", sample: formatPeso(123456) }));

  // "Can the server reach the database?" check.
  app.get("/health/db", async (_request, reply) => {
    if (!sql) return reply.code(503).send({ status: "no database configured" });
    try {
      await sql`select 1`;
      return { status: "ok" };
    } catch (err) {
      app.log.error(err);
      return reply.code(503).send({ status: "database unreachable" });
    }
  });

  if (sql) {
    registerGroupRoutes(app, sql);
    registerExpenseRoutes(app, sql);
  }

  return app;
}