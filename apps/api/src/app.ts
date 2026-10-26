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
import { registerPaymentRoutes } from "./routes/payments";
import { requestLogSerializer } from "./log";
import { registerAuthRoutes } from "./routes/auth";
import { unconfiguredMailer, type Mailer } from "./mailer";

export function buildApp(
  // rateLimit: false turns off the login-email limit. Only tests that send many requests use it.
  options: { logger?: boolean; sql?: Sql; mailer?: Mailer; appUrl?: string; rateLimit?: boolean } = {},
) {
  const app = Fastify({
    // When logging is on, hide share-link tokens from the request log.
    logger: options.logger ? { serializers: { req: requestLogSerializer } } : false,
    // Largest normal request body. Screenshot uploads set their own limit in routes/payments.ts.
    bodyLimit: 64 * 1024,
  });
  const { sql } = options;

  // Browser safety headers. The API only returns JSON, so it should never be framed,
  // sniffed, or loaded as a page.
  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
    reply.header("Cross-Origin-Resource-Policy", "same-origin");
    return payload;
  });

  // A simple "is the server alive?" check. The sample proves the API can use @split/core.
  app.get("/health", async () => ({ status: "ok", sample: formatPeso(123456) }));

  if (sql) {
    registerGroupRoutes(app, sql);
    registerExpenseRoutes(app, sql);
    registerLinkRoutes(app, sql);
    registerPaymentRoutes(app, sql);
    registerAuthRoutes(app, sql, {
      mailer: options.mailer ?? unconfiguredMailer,
      appUrl: options.appUrl ?? "http://localhost:5173",
      rateLimit: options.rateLimit ?? true,
    });
  }

  return app;
}