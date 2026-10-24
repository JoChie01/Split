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
import { sessionCookie } from "./test-helpers";

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

describe("POST /groups/:groupId/members", () => {
  it("adds a member with payment details, and does not send the account details back", async () => {
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
