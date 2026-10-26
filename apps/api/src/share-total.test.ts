/**
 * share-total.test.ts
 *
 * WHAT: Checks that the database refuses a confirmed bill whose shares don't add up to its total,
 *       and still allows drafts with partial shares.
 * RUN:  npm test (from apps/api)
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createSql, type Sql } from "./db";

const DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://localhost:5432/split_test";

let sql: Sql;

beforeAll(() => {
  sql = createSql(DATABASE_URL);
});

afterAll(async () => {
  await sql.end();
});

beforeEach(async () => {
  await sql`truncate groups cascade`;
});

/** A group with Ana and Ben in it. Returns their ids. */
async function twoPeople() {
  const [group] = await sql<{ id: string }[]>`insert into groups (name) values ('Trip') returning id`;
  const groupId = group!.id;
  const [ana] = await sql<{ id: string }[]>`
    insert into members (group_id, display_name) values (${groupId}, 'Ana') returning id`;
  const [ben] = await sql<{ id: string }[]>`
    insert into members (group_id, display_name) values (${groupId}, 'Ben') returning id`;
  return { groupId, ana: ana!.id, ben: ben!.id };
}

describe("share totals in the database", () => {
  it("saves a confirmed bill whose shares add up to its total", async () => {
    const { groupId, ana, ben } = await twoPeople();

    await sql.begin(async (tx) => {
      const [bill] = await tx<{ id: string }[]>`
        insert into expenses (group_id, paid_by_member_id, title, total_centavos, split_mode, status)
        values (${groupId}, ${ana}, 'Merienda', 10000, 'equal', 'confirmed')
        returning id`;
      await tx`insert into expense_shares (expense_id, member_id, amount_centavos) values (${bill!.id}, ${ana}, 5000)`;
      await tx`insert into expense_shares (expense_id, member_id, amount_centavos) values (${bill!.id}, ${ben}, 5000)`;
    });

    const [row] = await sql<{ count: number }[]>`select count(*)::int as count from expenses where group_id = ${groupId}`;
    expect(row!.count).toBe(1);
  });

  it("refuses a confirmed bill whose shares are short of its total", async () => {
    const { groupId, ana, ben } = await twoPeople();

    await expect(
      sql.begin(async (tx) => {
        const [bill] = await tx<{ id: string }[]>`
          insert into expenses (group_id, paid_by_member_id, title, total_centavos, split_mode, status)
          values (${groupId}, ${ana}, 'Merienda', 10000, 'equal', 'confirmed')
          returning id`;
        await tx`insert into expense_shares (expense_id, member_id, amount_centavos) values (${bill!.id}, ${ana}, 4000)`;
        await tx`insert into expense_shares (expense_id, member_id, amount_centavos) values (${bill!.id}, ${ben}, 5000)`;
      }),
    ).rejects.toThrow(/add up to 9000 but its total is 10000/);
  });

  it("allows a draft whose shares don't cover the total yet", async () => {
    const { groupId, ana, ben } = await twoPeople();

    await sql.begin(async (tx) => {
      const [bill] = await tx<{ id: string }[]>`
        insert into expenses (group_id, paid_by_member_id, title, total_centavos, split_mode, status)
        values (${groupId}, ${ana}, 'Dinner', 10000, 'items', 'draft')
        returning id`;
      await tx`insert into expense_shares (expense_id, member_id, amount_centavos) values (${bill!.id}, ${ben}, 4000)`;
    });

    const [row] = await sql<{ count: number }[]>`select count(*)::int as count from expenses where group_id = ${groupId}`;
    expect(row!.count).toBe(1);
  });

  it("refuses to confirm a draft whose shares are short", async () => {
    const { groupId, ana, ben } = await twoPeople();
    const [bill] = await sql<{ id: string }[]>`
      insert into expenses (group_id, paid_by_member_id, title, total_centavos, split_mode, status)
      values (${groupId}, ${ana}, 'Dinner', 10000, 'items', 'draft')
      returning id`;
    await sql`insert into expense_shares (expense_id, member_id, amount_centavos) values (${bill!.id}, ${ben}, 4000)`;

    await expect(sql`update expenses set status = 'confirmed' where id = ${bill!.id}`).rejects.toThrow(
      /add up to 4000 but its total is 10000/,
    );
  });
});
