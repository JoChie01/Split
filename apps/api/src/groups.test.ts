/**
 * groups.test.ts
 *
 * WHAT: Checks the groups and members endpoints against the real "split_test" database.
 *       Each test starts with empty group tables. Requests are sent as a named person.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { InjectOptions } from "fastify";
import { buildApp } from "./app";
import { createSql } from "./db";
import { runMigrations } from "./migrate";
import { sessionCookie, takeSeat } from "./test-helpers";

const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ?? "postgres://localhost:5432/split_test";

const sql = createSql(testDatabaseUrl);
const app = buildApp({ sql });

// A valid id that no group has.
const unknownId = "3f2b8c1e-9d4a-4b7e-8a1c-5d6e7f8091a2";

let ana: string; // Ana's session cookie
let ben: string; // Ben's session cookie

/** Sends a request as the person whose cookie is given. */
function as(cookie: string | undefined, opts: InjectOptions) {
  return app.inject({ ...opts, headers: cookie ? { cookie } : {} });
}

beforeAll(async () => {
  await runMigrations(sql);
  await app.ready();
});

beforeEach(async () => {
  await sql`truncate groups cascade`;
  ana = await sessionCookie(sql, "ana@example.com");
  ben = await sessionCookie(sql, "ben@example.com");
});

afterAll(async () => {
  await app.close();
  await sql.end();
});

async function createGroup(name = "Baguio Trip", cookie = ana) {
  const res = await as(cookie, {
    method: "POST",
    url: "/groups",
    payload: { name, yourName: "Ana" },
  });
  return res.json() as { id: string; name: string };
}

describe("POST /groups", () => {
  it("creates a group and makes the creator its first member", async () => {
    const res = await as(ana, {
      method: "POST",
      url: "/groups",
      payload: { name: "  Baguio Trip  ", yourName: "Ana" },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ name: "Baguio Trip" });

    const members = await as(ana, { method: "GET", url: `/groups/${res.json().id}` });
    expect(members.json().members).toEqual([
      expect.objectContaining({ displayName: "Ana", isYou: true }),
    ]);
  });

  it("refuses to create a group when nobody is logged in", async () => {
    const res = await as(undefined, {
      method: "POST",
      url: "/groups",
      payload: { name: "Baguio Trip", yourName: "Ana" },
    });

    expect(res.statusCode).toBe(401);
  });

  it("refuses an empty name", async () => {
    const res = await as(ana, { method: "POST", url: "/groups", payload: { name: "   ", yourName: "Ana" } });

    expect(res.statusCode).toBe(400);
  });
});

describe("GET /me/groups", () => {
  it("lists only the groups you belong to", async () => {
    await createGroup("Baguio Trip", ana);
    await createGroup("Office lunch", ben); // Ben's group, not Ana's

    const res = await as(ana, { method: "GET", url: "/me/groups" });

    expect(res.json().map((g: { name: string }) => g.name)).toEqual(["Baguio Trip"]);
  });
});

describe("GET /groups/:groupId", () => {
  it("returns the group with its members, and marks your own seat", async () => {
    const group = await createGroup();
    await as(ana, { method: "POST", url: `/groups/${group.id}/members`, payload: { displayName: "Walt" } });

    const res = await as(ana, { method: "GET", url: `/groups/${group.id}` });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: group.id, name: "Baguio Trip" });
    expect(res.json().members).toEqual([
      expect.objectContaining({ displayName: "Ana", isYou: true }),
      expect.objectContaining({ displayName: "Walt", isYou: false }),
    ]);
  });

  it("answers 404 to someone who is not a member, as if the group did not exist", async () => {
    const group = await createGroup();

    const res = await as(ben, { method: "GET", url: `/groups/${group.id}` });

    expect(res.statusCode).toBe(404);
  });

  it("answers 401 when nobody is logged in", async () => {
    const group = await createGroup();

    const res = await as(undefined, { method: "GET", url: `/groups/${group.id}` });

    expect(res.statusCode).toBe(401);
  });

  it("answers 404 for a group that does not exist", async () => {
    const res = await as(ana, { method: "GET", url: `/groups/${unknownId}` });

    expect(res.statusCode).toBe(404);
  });

  it("answers 400 when the id is not a real id", async () => {
    const res = await as(ana, { method: "GET", url: "/groups/not-an-id" });

    expect(res.statusCode).toBe(400);
  });
});

describe("owner view and joined status", () => {
  it("the owner sees which seats have joined", async () => {
    const group = await createGroup();
    const walt = await as(ana, { method: "POST", url: `/groups/${group.id}/members`, payload: { displayName: "Walt" } });
    await takeSeat(sql, walt.json().id, "ben@example.com");

    const res = await as(ana, { method: "GET", url: `/groups/${group.id}` });

    expect(res.json().isOwner).toBe(true);
    expect(res.json().members.map((m: { joined: boolean }) => m.joined)).toEqual([true, true]);
  });

  it("other members don't see the joined status", async () => {
    const group = await createGroup();
    const walt = await as(ana, { method: "POST", url: `/groups/${group.id}/members`, payload: { displayName: "Walt" } });
    await takeSeat(sql, walt.json().id, "ben@example.com");

    const res = await as(ben, { method: "GET", url: `/groups/${group.id}` });

    expect(res.json().isOwner).toBe(false);
    expect(res.json().members[0]).not.toHaveProperty("joined");
  });
});

describe("DELETE /groups/:groupId/members/:memberId", () => {
  async function addByName(groupId: string, displayName: string, cookie = ana): Promise<string> {
    const res = await as(cookie, { method: "POST", url: `/groups/${groupId}/members`, payload: { displayName } });
    return res.json().id as string;
  }

  it("the owner can remove a seat that hasn't joined and has no bills", async () => {
    const group = await createGroup();
    const walt = await addByName(group.id, "Walt");

    const res = await as(ana, { method: "DELETE", url: `/groups/${group.id}/members/${walt}` });

    expect(res.statusCode).toBe(204);
    const members = await as(ana, { method: "GET", url: `/groups/${group.id}` });
    expect(members.json().members.map((m: { displayName: string }) => m.displayName)).toEqual(["Ana"]);
  });

  it("the owner can't remove their own seat", async () => {
    const group = await createGroup();
    const details = await as(ana, { method: "GET", url: `/groups/${group.id}` });
    const anaSeat = details.json().members[0].id as string;

    const res = await as(ana, { method: "DELETE", url: `/groups/${group.id}/members/${anaSeat}` });

    expect(res.statusCode).toBe(409);
  });

  it("a seat that has joined can't be removed", async () => {
    const group = await createGroup();
    const walt = await addByName(group.id, "Walt");
    await takeSeat(sql, walt, "ben@example.com");

    const res = await as(ana, { method: "DELETE", url: `/groups/${group.id}/members/${walt}` });

    expect(res.statusCode).toBe(409);
  });

  it("a seat on a bill can't be removed", async () => {
    const group = await createGroup();
    const walt = await addByName(group.id, "Walt");
    const bill = await as(ana, {
      method: "POST",
      url: `/groups/${group.id}/expenses`,
      payload: {
        title: "Merienda",
        paidByMemberId: walt,
        totalCentavos: 10000,
        splitMode: "equal",
        participantIds: [walt],
      },
    });
    expect(bill.statusCode).toBe(201);

    const res = await as(ana, { method: "DELETE", url: `/groups/${group.id}/members/${walt}` });

    expect(res.statusCode).toBe(409);
  });

  it("only the owner can remove seats", async () => {
    const group = await createGroup();
    const walt = await addByName(group.id, "Walt");
    const benSeat = await addByName(group.id, "Ben");
    await takeSeat(sql, benSeat, "ben@example.com");

    const res = await as(ben, { method: "DELETE", url: `/groups/${group.id}/members/${walt}` });

    expect(res.statusCode).toBe(403);
  });

  it("someone who isn't a member gets 404", async () => {
    const group = await createGroup();
    const walt = await addByName(group.id, "Walt");

    const res = await as(ben, { method: "DELETE", url: `/groups/${group.id}/members/${walt}` });

    expect(res.statusCode).toBe(404);
  });
});

describe("POST /groups/:groupId/members", () => {
  it("adds a member with a payment method, and ignores any account details sent with it", async () => {
    const group = await createGroup();

    const res = await as(ana, {
      method: "POST",
      url: `/groups/${group.id}/members`,
      payload: {
        displayName: "Ben",
        paymentMethod: "GCash",
        accountName: "Ben Reyes",
        accountNumber: "09171234567",
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ displayName: "Ben", paymentMethod: "GCash" });
    expect(res.json()).not.toHaveProperty("accountNumber");
    expect(res.json()).not.toHaveProperty("accountName");
  });

  it("the database no longer has columns for account details", async () => {
    const rows = await sql<{ column_name: string }[]>`
      select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'members'`;

    const columns = rows.map((r) => r.column_name);
    expect(columns).not.toContain("account_number");
    expect(columns).not.toContain("account_name");
  });

  it("refuses a duplicate name, even in different letters", async () => {
    const group = await createGroup();
    const add = (displayName: string) =>
      as(ana, { method: "POST", url: `/groups/${group.id}/members`, payload: { displayName } });

    expect((await add("Walt")).statusCode).toBe(201);
    expect((await add("walt")).statusCode).toBe(409);
  });

  it("refuses someone who is not a member of the group", async () => {
    const group = await createGroup();

    const res = await as(ben, {
      method: "POST",
      url: `/groups/${group.id}/members`,
      payload: { displayName: "Dan" },
    });

    expect(res.statusCode).toBe(404);
  });

  it("answers 404 when the group does not exist", async () => {
    const res = await as(ana, {
      method: "POST",
      url: `/groups/${unknownId}/members`,
      payload: { displayName: "Walt" },
    });

    expect(res.statusCode).toBe(404);
  });

  it("refuses a member without a name", async () => {
    const group = await createGroup();

    const res = await as(ana, {
      method: "POST",
      url: `/groups/${group.id}/members`,
      payload: { paymentMethod: "GCash" },
    });

    expect(res.statusCode).toBe(400);
  });
});
