/**
 * links.test.ts
 *
 * WHAT: Tests for shareable group links (routes/links.ts).
 *       A link lets a logged-in person join. Claims and confirmations never go through a link.
 * RUN:  npm test (from apps/api)
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance, InjectOptions } from "fastify";
import { buildApp } from "./app";
import { createSql, type Sql } from "./db";
import { sessionCookie } from "./test-helpers";

const DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://localhost:5432/split_test";

let app: FastifyInstance;
let sql: Sql;
let carlCookie = "";
let benCookie = "";
let danCookie = "";

function as(cookie: string | undefined, opts: InjectOptions) {
  return app.inject({ ...opts, headers: cookie ? { cookie } : {} });
}

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
  // Clear the groups between tests. Accounts stay, so cookies stay valid.
  await sql`truncate groups cascade`;
  carlCookie = await sessionCookie(sql, "carl@example.com");
  benCookie = await sessionCookie(sql, "ben@example.com");
  danCookie = await sessionCookie(sql, "dan@example.com");
});

describe("shareable links", () => {
  /** Carl creates "Trip" with three seats: Ana and Ben (no account yet) and Carl himself. */
  async function makeGroup() {
    const group = await as(carlCookie, {
      method: "POST",
      url: "/groups",
      payload: { name: "Trip", yourName: "Carl" },
    });
    const groupId = group.json().id as string;
    const ids: Record<string, string> = {};
    const details = await as(carlCookie, { method: "GET", url: `/groups/${groupId}` });
    ids.Carl = details.json().members.find((m: { isYou: boolean }) => m.isYou).id as string;
    for (const name of ["Ana", "Ben"]) {
      const res = await as(carlCookie, {
        method: "POST",
        url: `/groups/${groupId}/members`,
        payload: { displayName: name },
      });
      ids[name] = res.json().id as string;
    }
    return { groupId, carl: ids.Carl!, ana: ids.Ana!, ben: ids.Ben! };
  }

  async function makeLink(groupId: string): Promise<string> {
    const res = await as(carlCookie, { method: "POST", url: `/groups/${groupId}/links` });
    expect(res.statusCode).toBe(201);
    return res.json().token as string;
  }

  /** A draft bill with two unclaimed items, paid by Carl. */
  async function draftBill(groupId: string) {
    const group = await as(carlCookie, { method: "GET", url: `/groups/${groupId}` });
    const carl = group.json().members.find((m: { isYou: boolean }) => m.isYou).id as string;
    const res = await as(carlCookie, {
      method: "POST",
      url: `/groups/${groupId}/expenses`,
      payload: {
        title: "Dinner",
        paidByMemberId: carl,
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

  it("a logged-in person can open a link and sees the seats", async () => {
    const { groupId } = await makeGroup();
    const token = await makeLink(groupId);

    const res = await as(benCookie, { method: "GET", url: `/join/${token}` });

    expect(res.statusCode).toBe(200);
    expect(res.json().group.name).toBe("Trip");
    expect(res.json().seats).toEqual([
      { id: expect.any(String), displayName: "Ana", taken: false },
      { id: expect.any(String), displayName: "Ben", taken: false },
      { id: expect.any(String), displayName: "Carl", taken: true },
    ]);
    expect(res.json().alreadyMember).toBe(false);
  });

  it("opening a link without logging in is refused", async () => {
    const { groupId } = await makeGroup();
    const token = await makeLink(groupId);

    const res = await as(undefined, { method: "GET", url: `/join/${token}` });

    expect(res.statusCode).toBe(401);
  });

  it("a wrong link shows nothing", async () => {
    const res = await as(benCookie, { method: "GET", url: "/join/this-link-does-not-exist-at-all" });

    expect(res.statusCode).toBe(404);
  });

  it("taking a free seat makes you a member, who can then see the group", async () => {
    const { groupId, ben } = await makeGroup();
    const token = await makeLink(groupId);

    const join = await as(benCookie, {
      method: "POST",
      url: `/join/${token}/join`,
      payload: { memberId: ben },
    });
    expect(join.statusCode).toBe(201);

    const group = await as(benCookie, { method: "GET", url: `/groups/${groupId}` });
    expect(group.statusCode).toBe(200);
    expect(group.json().members.find((m: { isYou: boolean }) => m.isYou).displayName).toBe("Ben");
  });

  it("a seat someone else already took can't be taken again", async () => {
    const { groupId, ben } = await makeGroup();
    const token = await makeLink(groupId);
    await as(benCookie, { method: "POST", url: `/join/${token}/join`, payload: { memberId: ben } });

    const res = await as(danCookie, { method: "POST", url: `/join/${token}/join`, payload: { memberId: ben } });

    expect(res.statusCode).toBe(409);
  });

  it("you can add yourself as a new member", async () => {
    const { groupId } = await makeGroup();
    const token = await makeLink(groupId);

    const res = await as(danCookie, {
      method: "POST",
      url: `/join/${token}/join`,
      payload: { displayName: "Dan" },
    });

    expect(res.statusCode).toBe(201);
    const group = await as(danCookie, { method: "GET", url: `/groups/${groupId}` });
    expect(group.json().members.map((m: { displayName: string }) => m.displayName)).toContain("Dan");
  });

  it("someone who joined can't join again", async () => {
    const { groupId, ben } = await makeGroup();
    const token = await makeLink(groupId);
    await as(benCookie, { method: "POST", url: `/join/${token}/join`, payload: { memberId: ben } });

    const res = await as(benCookie, { method: "GET", url: `/join/${token}` });
    expect(res.json().alreadyMember).toBe(true);

    const again = await as(benCookie, { method: "POST", url: `/join/${token}/join`, payload: { displayName: "Ben2" } });
    expect(again.statusCode).toBe(409);
  });

  it("a link does not let someone see bills before they join", async () => {
    const { groupId } = await makeGroup();
    await draftBill(groupId);
    const token = await makeLink(groupId);

    const res = await as(danCookie, { method: "GET", url: `/join/${token}` });

    expect(res.json()).not.toHaveProperty("expenses");
    const bills = await as(danCookie, { method: "GET", url: `/groups/${groupId}/expenses` });
    expect(bills.statusCode).toBe(404);
  });

  it("the old anonymous claim route is gone", async () => {
    const { groupId, ben } = await makeGroup();
    const bill = await draftBill(groupId);
    const token = await makeLink(groupId);

    const res = await as(undefined, {
      method: "POST",
      url: `/join/${token}/expenses/${bill.id}/items/00000000-0000-0000-0000-000000000000/claims`,
      payload: { memberId: ben },
    });

    expect(res.statusCode).toBe(404);
  });

  it("an expired link stops working", async () => {
    const { groupId } = await makeGroup();
    const token = await makeLink(groupId);

    await sql`update group_links set expires_at = now() - interval '1 minute'`;

    const res = await as(benCookie, { method: "GET", url: `/join/${token}` });
    expect(res.statusCode).toBe(404);
  });

  it("only members can make a link", async () => {
    const { groupId } = await makeGroup();

    const res = await as(danCookie, { method: "POST", url: `/groups/${groupId}/links` });

    expect(res.statusCode).toBe(404);
  });

  it("a link can't be made for a group that doesn't exist", async () => {
    const res = await as(carlCookie, {
      method: "POST",
      url: "/groups/00000000-0000-0000-0000-000000000000/links",
    });
    expect(res.statusCode).toBe(404);
  });
});
