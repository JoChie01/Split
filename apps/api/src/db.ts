/**
 * db.ts
 *
 * WHAT: Creates the connection to PostgreSQL.
 * NOTE: The connection opens lazily, on the first query, so the server can
 *       start even if the database is down. /health/db tells you which it is.
 */
import postgres from "postgres";

export function createSql(url: string) {
  return postgres(url);
}

export type Sql = ReturnType<typeof createSql>;