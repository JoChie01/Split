/**
 * migrate.test.ts
 *
 * WHAT: Checks the migrations and the rules the database enforces by itself.
 * NOTE: Uses the separate "split_test" database.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createSql } from "./db";
import { runMigrations } from "./migrate";

const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ?? "postgres://localhost:5432/split_test";

// Each statement makes a group and a member, then tries ONE bad row. Because it is a
// single statement, when the database refuses it, everything is undone: no leftovers.
const billWithZeroTotal = `
  with g as (insert into groups (name) values ('Trip') returning id),
       m as (insert into members (group_id, display_name)
             select id, 'Ana' from g returning id, group_id)
  insert into expenses (group_id, paid_by_member_id, title, total_centavos, split_mode)
  select group_id, id, 'Dinner', 0, 'equal' from m`;

const paymentToYourself = `
  with g as (insert into groups (name) values ('Trip') returning id),
       m as (insert into members (group_id, display_name)
             select id, 'Ana' from g returning id, group_id)
  insert into payments (group_id, from_member_id, to_member_id, mode, status)
  select group_id, id, id, 'reimburse', 'pending' from m`;

const sql = createSql(testDatabaseUrl);

beforeAll(async () => {
  await runMigrations(sql);
});

afterAll(async () => {
  await sql.end();
});

describe("database migrations", () => {
  it("creates every table", async () => {
    const rows = await sql<{ table_name: string }[]>`
      select table_name from information_schema.tables where table_schema = 'public'`;

    expect(rows.map((row) => row.table_name).sort()).toEqual([
      "expense_item_sharers",
      "expense_items",
      "expense_shares",
      "expenses",
      "groups",
      "members",
      "payment_allocations",
      "payments",
      "schema_migrations",
    ]);
  });

  it("does nothing when run a second time", async () => {
    expect(await runMigrations(sql)).toEqual([]);
  });
});

describe("rules the database enforces", () => {
  it("refuses a bill with a zero total", async () => {
    await expect(sql.unsafe(billWithZeroTotal)).rejects.toThrow("expenses_total_centavos_check");
  });

  it("refuses a payment from a person to themselves", async () => {
    await expect(sql.unsafe(paymentToYourself)).rejects.toThrow("payments_different_people");
  });
});