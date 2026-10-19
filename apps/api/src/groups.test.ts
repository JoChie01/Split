/**
 * groups.test.ts
 *
 * WHAT: Checks the groups and members endpoints against the real "split_test" database.
 *       The tables are emptied before every test so tests never affect each other.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { buildApp } from "./app";
import { createSql } from "./db";
import { runMigrations } from "./migrate";

const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ?? "postgres://localhost:5432/split_test";

const sql = createSql(testDatabaseUrl);
const app = buildApp({ sql });

// A valid id that no group has.
const unknownId = "3f2b8c1e-9d4a-4b7e-8a1c-5d6e7f8091a2";

beforeAll(async () => {
  await runMigrations(sql);
  await app.ready();
});

beforeEach(async () => {
  await sql`truncate groups cascade`;
});

afterAll(async () => {
  await app.close();
  await sql.end();
});

async function createGroup(name = "Baguio Trip") {
  const res = await app.inject({ method: "POST", url: "/groups", payload: { name } });
  return res.json() as { id: string; name: string };
}

describe("POST /groups", () => {
  it("creates a group and trims the name", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/groups",
      payload: { name: "  Baguio Trip  " },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ name: "Baguio Trip" });
    expect(res.json().id).toEqual(expect.any(String));
  });

  it("refuses an empty name", async () => {
    const res = await app.inject({ method: "POST", url: "/groups", payload: { name: "   " } });

    expect(res.statusCode).toBe(400);
  });
});

describe("GET /groups/:groupId", () => {
  it("returns the group with its members", async () => {
    const group = await createGroup();
    await app.inject({
      method: "POST",
      url: `/groups/${group.id}/members`,
      payload: { displayName: "Ana" },
    });

    const res = await app.inject({ method: "GET", url: `/groups/${group.id}` });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      id: group.id,
      name: "Baguio Trip",
      members: [{ displayName: "Ana", paymentMethod: null }],
    });
  });

  it("answers 404 for a group that does not exist", async () => {
    const res = await app.inject({ method: "GET", url: `/groups/${unknownId}` });

    expect(res.statusCode).toBe(404);
  });

  it("answers 400 when the id is not a real id", async () => {
    const res = await app.inject({ method: "GET", url: "/groups/not-an-id" });

    expect(res.statusCode).toBe(400);
  });
});

describe("POST /groups/:groupId/members", () => {
  it("adds a member with payment details", async () => {
    const group = await createGroup();

    const res = await app.inject({
      method: "POST",
      url: `/groups/${group.id}/members`,
      payload: {
        displayName: "Ana",
        paymentMethod: "GCash",
        accountName: "Ana Reyes",
        accountNumber: "09171234567",
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      displayName: "Ana",
      paymentMethod: "GCash",
      accountName: "Ana Reyes",
      accountNumber: "09171234567",
    });
  });

  it("refuses a duplicate name, even in different letters", async () => {
    const group = await createGroup();
    const add = (displayName: string) =>
      app.inject({
        method: "POST",
        url: `/groups/${group.id}/members`,
        payload: { displayName },
      });

    expect((await add("Ana")).statusCode).toBe(201);
    expect((await add("ana")).statusCode).toBe(409);
  });

  it("answers 404 when the group does not exist", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/groups/${unknownId}/members`,
      payload: { displayName: "Ana" },
    });

    expect(res.statusCode).toBe(404);
  });

  it("refuses a member without a name", async () => {
    const group = await createGroup();

    const res = await app.inject({
      method: "POST",
      url: `/groups/${group.id}/members`,
      payload: { paymentMethod: "GCash" },
    });

    expect(res.statusCode).toBe(400);
  });
});