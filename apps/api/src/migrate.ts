/**
 * migrate.ts
 *
 * WHAT: Applies the SQL files in apps/api/migrations, in order, once each.
 * HOW: A table called schema_migrations remembers which files were already applied.
 *      Each file runs inside a transaction: it fully works, or nothing changes.
 */
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Sql } from "./db";

const migrationsDir = fileURLToPath(new URL("../migrations/", import.meta.url));

/** Returns the names of the migrations that were applied just now. */
export async function runMigrations(sql: Sql): Promise<string[]> {
  await sql`
    create table if not exists schema_migrations (
      name       text primary key,
      applied_at timestamptz not null default now()
    )
  `;

  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();
  const done = await sql<{ name: string }[]>`select name from schema_migrations`;
  const applied = new Set(done.map((row) => row.name));
  const ran: string[] = [];

  for (const file of files) {
    if (applied.has(file)) continue;
    const text = await readFile(migrationsDir + file, "utf8");
    await sql.begin(async (tx) => {
      await tx.unsafe(text).simple(); // "simple" lets one file hold many statements
      await tx`insert into schema_migrations (name) values (${file})`;
    });
    ran.push(file);
  }
  return ran;
}