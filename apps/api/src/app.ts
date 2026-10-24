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
import { registerLinkRoutes } from "./routes/links";
import { requestLogSerializer } from "./log";
import { registerAuthRoutes } from "./routes/auth";
import { unconfiguredMailer, type Mailer } from "./mailer";

export function buildApp(
  options: { logger?: boolean; sql?: Sql; mailer?: Mailer; appUrl?: string } = {},
) {
  const app = Fastify({
    // When logging is on, hide share-link tokens from the request log.
    logger: options.logger ? { serializers: { req: requestLogSerializer } } : false,
  });
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
    registerLinkRoutes(app, sql);
    registerAuthRoutes(app, sql, {
      mailer: options.mailer ?? unconfiguredMailer,
      appUrl: options.appUrl ?? "http://localhost:5173",
    });
  }

  return app;
}