/**
 * server.ts
 *
 * WHAT: Starts the API. Run it with `npm run dev -w @split/api`.
 * CONFIG: Settings come from environment variables (see .env.example).
 */
import { buildApp } from "./app";
import { createSql } from "./db";

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "127.0.0.1"; // only your own computer can reach it

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set. Copy .env.example to .env first.");
  process.exit(1);
}

const sql = createSql(databaseUrl);
const app = buildApp({ logger: true, sql });
app.addHook("onClose", async () => {
  await sql.end(); // close the database connection when the server stops
});

try {
  await app.listen({ port, host });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}