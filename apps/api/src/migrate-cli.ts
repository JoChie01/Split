/**
 * migrate-cli.ts
 *
 * WHAT: Runs the migrations against DATABASE_URL.
 *       Use it with `npm run migrate -w @split/api`.
 */
import { createSql } from "./db";
import { runMigrations } from "./migrate";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set. Copy .env.example to .env first.");
  process.exit(1);
}

const sql = createSql(databaseUrl);
try {
  const ran = await runMigrations(sql);
  console.log(ran.length === 0 ? "Database is up to date." : `Applied: ${ran.join(", ")}`);
} finally {
  await sql.end();
}