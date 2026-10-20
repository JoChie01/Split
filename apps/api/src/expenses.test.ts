/**
 * expenses.test.ts
 *
 * WHAT: Checks bills against the real "split_test" database.
 *       Each test starts from empty tables and makes its own group and people.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { buildApp } from "./app";
import { createSql } from "./db";
import { runMigrations } from "./migrate";

const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ?? "postgres://localhost:5432/split_test";

const sql = createSql(testDatabaseUrl);
const app = buildApp({ sql });

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

/** A group with three people: Ana, Ben and Carl. */
async function setupGroup() {
  const group = (
    await app.inject({ method: "POST", url: "/groups", payload: { name: "Baguio Trip" } })
  ).json() as { id: string };

  const people: Record<string, string> = {};
  for (const name of ["Ana", "Ben", "Carl"]) {
    const res = await app.inject({
      method: "POST",
      url: `/groups/${group.id}/members`,
      payload: { displayName: name },
    });
    people[name] = (res.json() as { id: string }).id;
  }
  return { groupId: group.id, ana: people.Ana!, ben: people.Ben!, carl: people.Carl! };
}

describe("POST /groups/:groupId/expenses", () => {
  it("splits equally, and the payer covers the leftover centavos", async () => {
    const { groupId, ana, ben, carl } = await setupGroup();

    // ₱100.00 split 3 ways is 3333.33 centavos each, so the payer takes the extra centavo.
    const res = await app.inject({
      method: "POST",
      url: `/groups/${groupId}/expenses`,
      payload: {
        title: "Dinner",
        paidByMemberId: ana,
        totalCentavos: 10000,
        splitMode: "equal",
        participantIds: [ana, ben, carl],
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.shares).toEqual({ [ana]: 3334, [ben]: 3333, [carl]: 3333 });
    expect(Object.values(body.shares as Record<string, number>).reduce((a, b) => a + b)).toBe(10000);
  });

  it("saves exact amounts", async () => {
    const { groupId, ana, ben } = await setupGroup();

    const res = await app.inject({
      method: "POST",
      url: `/groups/${groupId}/expenses`,
      payload: {
        title: "Taxi",
        paidByMemberId: ana,
        totalCentavos: 15000,
        splitMode: "amount",
        amounts: { [ana]: 5000, [ben]: 10000 },
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().shares).toEqual({ [ana]: 5000, [ben]: 10000 });
  });

  it("splits by percent", async () => {
    const { groupId, ana, ben } = await setupGroup();

    const res = await app.inject({
      method: "POST",
      url: `/groups/${groupId}/expenses`,
      payload: {
        title: "Groceries",
        paidByMemberId: ana,
        totalCentavos: 20000,
        splitMode: "percent",
        basisPoints: { [ana]: 6000, [ben]: 4000 },
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().shares).toEqual({ [ana]: 12000, [ben]: 8000 });
  });

  it("answers 422 when the amounts don't add up to the total", async () => {
    const { groupId, ana, ben } = await setupGroup();

    const res = await app.inject({
      method: "POST",
      url: `/groups/${groupId}/expenses`,
      payload: {
        title: "Taxi",
        paidByMemberId: ana,
        totalCentavos: 15000,
        splitMode: "amount",
        amounts: { [ana]: 5000, [ben]: 5000 },
      },
    });

    expect(res.statusCode).toBe(422);
  });

  it("answers 422 when percentages don't reach 100%", async () => {
    const { groupId, ana, ben } = await setupGroup();

    const res = await app.inject({
      method: "POST",
      url: `/groups/${groupId}/expenses`,
      payload: {
        title: "Groceries",
        paidByMemberId: ana,
        totalCentavos: 20000,
        splitMode: "percent",
        basisPoints: { [ana]: 5000, [ben]: 3000 },
      },
    });

    expect(res.statusCode).toBe(422);
  });

  it("refuses someone who is not in this group", async () => {
    const first = await setupGroup();
    const second = await setupGroup();

    const res = await app.inject({
      method: "POST",
      url: `/groups/${first.groupId}/expenses`,
      payload: {
        title: "Dinner",
        paidByMemberId: first.ana,
        totalCentavos: 10000,
        splitMode: "equal",
        participantIds: [first.ana, second.ben],
      },
    });

    expect(res.statusCode).toBe(404);
  });

  it("refuses a bill with a decimal or zero amount", async () => {
    const { groupId, ana } = await setupGroup();
    const post = (totalCentavos: unknown) =>
      app.inject({
        method: "POST",
        url: `/groups/${groupId}/expenses`,
        payload: {
          title: "Dinner",
          paidByMemberId: ana,
          totalCentavos,
          splitMode: "equal",
          participantIds: [ana],
        },
      });

    expect((await post(199.99)).statusCode).toBe(400);
    expect((await post(0)).statusCode).toBe(400);
  });

  it("answers 404 for a group that does not exist", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/groups/${unknownId}/expenses`,
      payload: {
        title: "Dinner",
        paidByMemberId: unknownId,
        totalCentavos: 10000,
        splitMode: "equal",
        participantIds: [unknownId],
      },
    });

    expect(res.statusCode).toBe(404);
  });
});

describe("GET /groups/:groupId/expenses", () => {
  it("lists bills, newest first", async () => {
    const { groupId, ana, ben } = await setupGroup();
    const post = (title: string) =>
      app.inject({
        method: "POST",
        url: `/groups/${groupId}/expenses`,
        payload: {
          title,
          paidByMemberId: ana,
          totalCentavos: 10000,
          splitMode: "equal",
          participantIds: [ana, ben],
        },
      });
    await post("First");
    await post("Second");

    const res = await app.inject({ method: "GET", url: `/groups/${groupId}/expenses` });

    expect(res.statusCode).toBe(200);
    expect(res.json().map((e: { title: string }) => e.title)).toEqual(["Second", "First"]);
  });
});