/**
 * server.ts
 *
 * WHAT: Starts the API. Run it with `npm run dev -w @split/api`.
 * CONFIG: Settings come from environment variables, with safe defaults.
 */
import { buildApp } from "./app";

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "127.0.0.1"; // only your own computer can reach it

const app = buildApp({ logger: true });

try {
  await app.listen({ port, host });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}