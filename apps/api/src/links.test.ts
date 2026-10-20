/**
 * links.test.ts
 *
 * WHAT: Tests for shareable group links (routes/links.ts).
 * RUN:  npm test (from apps/api)
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app";
import { createSql, type Sql } from "./db";

const DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://localhost:5432/split_test";

let app: FastifyInstance;
let sql: Sql;

beforeAll(async () => {
  sql = createSql(DATABASE_URL);
  app = buildApp({ logger: false, sql });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await sql.end();
});

beforeEach(async () => {
  // Clear everything between tests so each one starts from a clean group list.
  await sql`truncate groups cascade`;
});

describe("shareable links", () => {
  async function makeGroup() {
    const group = await app.inject({ method: "POST", url: "/groups", payload: { name: "Trip" } });
    const groupId = group.json().id as string;
    const ids: Record<string, string> = {};
    for (const name of ["Ana", "Ben", "Carl"]) {
      const res = await app.inject({
        method: "POST",
        url: `/groups/${groupId}/members`,
        payload: { displayName: name },
      });
      ids[name] = res.json().id as string;
    }
    return { groupId, ana: ids.Ana!, ben: ids.Ben!, carl: ids.Carl! };
  }

  async function makeLink(groupId: string): Promise<string> {
    const res = await app.inject({ method: "POST", url: `/groups/${groupId}/links` });
    expect(res.statusCode).toBe(201);
    return res.json().token as string;
  }

  /** A draft bill with two unclaimed items, paid by the given member. */
  async function draftBill(groupId: string, payer: string) {
    const res = await app.inject({
      method: "POST",
      url: `/groups/${groupId}/expenses`,
      payload: {
        title: "Dinner",
        paidByMemberId: payer,
        totalCentavos: 55000,
        splitMode: "items",
        extrasCentavos: 0,
        items: [
          { name: "Pasta", priceCentavos: 20000, sharedByMemberIds: [] },
          { name: "Steak", priceCentavos: 35000, sharedByMemberIds: [] },
        ],
      },
    });
    return res.json() as { id: string };
  }

  it("a link opens the group, its members and its bills", async () => {
    const { groupId } = await makeGroup();
    const token = await makeLink(groupId);

    const res = await app.inject({ method: "GET", url: `/join/${token}` });

    expect(res.statusCode).toBe(200);
    expect(res.json().group.name).toBe("Trip");
    expect(res.json().members).toHaveLength(3);
    expect(res.json().expenses).toEqual([]);
  });

  it("a link does not show bills from other groups", async () => {
    const mine = await makeGroup();
    const other = await makeGroup();
    await draftBill(other.groupId, other.carl);
    const token = await makeLink(mine.groupId);

    const res = await app.inject({ method: "GET", url: `/join/${token}` });

    expect(res.json().expenses).toEqual([]);
  });

  it("a wrong link shows nothing", async () => {
    const res = await app.inject({ method: "GET", url: "/join/this-link-does-not-exist-at-all" });
    expect(res.statusCode).toBe(404);
  });

  it("claiming through a link updates the shares", async () => {
    const { groupId, ana, carl } = await makeGroup();
    const token = await makeLink(groupId);
    const bill = await draftBill(groupId, carl);

    const join = await app.inject({ method: "GET", url: `/join/${token}` });
    const pasta = join.json().expenses[0].items.find((item: { name: string }) => item.name === "Pasta");

    const res = await app.inject({
      method: "POST",
      url: `/join/${token}/expenses/${bill.id}/items/${pasta.id}/claims`,
      payload: { memberId: ana },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().shares).toEqual({ [ana]: 20000 });
  });

  it("a link can't confirm a bill", async () => {
    const { groupId, carl } = await makeGroup();
    const token = await makeLink(groupId);
    const bill = await draftBill(groupId, carl);

    const res = await app.inject({
      method: "POST",
      url: `/join/${token}/expenses/${bill.id}/confirm`,
    });

    expect(res.statusCode).toBe(404);
  });

  it("an expired link stops working", async () => {
    const { groupId } = await makeGroup();
    const token = await makeLink(groupId);

    await sql`update group_links set expires_at = now() - interval '1 minute'`;

    const res = await app.inject({ method: "GET", url: `/join/${token}` });
    expect(res.statusCode).toBe(404);
  });

  it("a link can't be made for a group that doesn't exist", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/groups/00000000-0000-0000-0000-000000000000/links",
    });
    expect(res.statusCode).toBe(404);
  });
});