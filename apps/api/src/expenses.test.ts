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

describe("items split", () => {
  it("splits by what each person ordered, and shares the extras by their food total", async () => {
    const { groupId, ana, ben, carl } = await setupGroup();

    // Pasta 200 (Ana), steak 350 (Ben), pitcher 150 (Ana and Ben), extras 0.
    // Ana: 200 + 75 = 275. Ben: 350 + 75 = 425.
    const res = await app.inject({
      method: "POST",
      url: `/groups/${groupId}/expenses`,
      payload: {
        title: "Dinner",
        paidByMemberId: carl,
        totalCentavos: 70000,
        splitMode: "items",
        extrasCentavos: 0,
        items: [
          { name: "Pasta", priceCentavos: 20000, sharedByMemberIds: [ana] },
          { name: "Steak", priceCentavos: 35000, sharedByMemberIds: [ben] },
          { name: "Pitcher", priceCentavos: 15000, sharedByMemberIds: [ana, ben] },
        ],
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().shares).toEqual({ [ana]: 27500, [ben]: 42500 });
  });

    it("shares tax and service charge in proportion to each person's food", async () => {
    const { groupId, ana, ben, carl } = await setupGroup();

    // Food: Ana 200, Ben 350 (total 550). Extras 55 shared 200:350,
    // so Ana pays 20 of it and Ben pays 35. Totals: Ana 220, Ben 385.
    const res = await app.inject({
      method: "POST",
      url: `/groups/${groupId}/expenses`,
      payload: {
        title: "Dinner",
        paidByMemberId: carl,
        totalCentavos: 60500,
        splitMode: "items",
        extrasCentavos: 5500,
        items: [
          { name: "Pasta", priceCentavos: 20000, sharedByMemberIds: [ana] },
          { name: "Steak", priceCentavos: 35000, sharedByMemberIds: [ben] },
        ],
      },
    });

    expect(res.statusCode).toBe(201);
    const shares = res.json().shares as Record<string, number>;
    expect(shares[ana]).toBe(22000);
    expect(shares[ben]).toBe(38500);
    expect(Object.values(shares).reduce((a, b) => a + b)).toBe(60500);
  });

  it("saves the items so they can be read back", async () => {
    const { groupId, ana, ben } = await setupGroup();

    const res = await app.inject({
      method: "POST",
      url: `/groups/${groupId}/expenses`,
      payload: {
        title: "Lunch",
        paidByMemberId: ana,
        totalCentavos: 20000,
        splitMode: "items",
        extrasCentavos: 0,
        items: [{ name: "Adobo", priceCentavos: 20000, sharedByMemberIds: [ana, ben] }],
      },
    });

    const rows = await sql<{ name: string; price_centavos: number }[]>`
      select name, price_centavos from expense_items where expense_id = ${res.json().id}`;
    expect(rows).toEqual([{ name: "Adobo", price_centavos: 20000 }]);
  });

  it("answers 422 when items and extras don't add up to the total", async () => {
    const { groupId, ana, ben } = await setupGroup();

    const res = await app.inject({
      method: "POST",
      url: `/groups/${groupId}/expenses`,
      payload: {
        title: "Lunch",
        paidByMemberId: ana,
        totalCentavos: 99999,
        splitMode: "items",
        extrasCentavos: 0,
        items: [{ name: "Adobo", priceCentavos: 20000, sharedByMemberIds: [ana, ben] }],
      },
    });

    expect(res.statusCode).toBe(422);
  });
});
describe("drafts, claims and confirmation", () => {
  /** Creates a draft item bill. Items start unclaimed unless you say otherwise. */
  async function draftItemsBill(
    groupId: string,
    payer: string,
    items: { name: string; priceCentavos: number; sharedByMemberIds?: string[] }[],
    total: number,
    extras = 0,
    extrasMode = "proportional",
  ) {
    const res = await app.inject({
      method: "POST",
      url: `/groups/${groupId}/expenses`,
      payload: {
        title: "Dinner",
        paidByMemberId: payer,
        totalCentavos: total,
        splitMode: "items",
        extrasCentavos: extras,
        extrasMode,
        items: items.map((item) => ({ sharedByMemberIds: [], ...item })),
      },
    });
    return res.json() as { id: string; status: string; shares: Record<string, number> };
  }

  async function getBill(groupId: string, expenseId: string) {
    const res = await app.inject({ method: "GET", url: `/groups/${groupId}/expenses/${expenseId}` });
    return res.json() as {
      status: string;
      items: { id: string; name: string; claimedBy: string[] }[];
      shares: Record<string, number>;
    };
  }

  it("a new bill starts as a draft", async () => {
    const { groupId, ana, ben, carl } = await setupGroup();
    const bill = await draftItemsBill(groupId, carl, [{ name: "Pasta", priceCentavos: 20000 }], 20000);
    expect(bill.status).toBe("draft");
    expect(ana).toBeDefined();
    expect(ben).toBeDefined();
  });

  it("claiming an item updates everyone's shares", async () => {
    const { groupId, ana, ben, carl } = await setupGroup();
    const bill = await draftItemsBill(
      groupId,
      carl,
      [
        { name: "Pasta", priceCentavos: 20000 },
        { name: "Steak", priceCentavos: 35000 },
      ],
      55000,
    );
    const [pasta, steak] = (await getBill(groupId, bill.id)).items;

    await app.inject({
      method: "POST",
      url: `/groups/${groupId}/expenses/${bill.id}/items/${pasta!.id}/claims`,
      payload: { memberId: ana },
    });
    expect((await getBill(groupId, bill.id)).shares).toEqual({ [ana]: 20000 });

    await app.inject({
      method: "POST",
      url: `/groups/${groupId}/expenses/${bill.id}/items/${steak!.id}/claims`,
      payload: { memberId: ben },
    });
    expect((await getBill(groupId, bill.id)).shares).toEqual({ [ana]: 20000, [ben]: 35000 });
  });

  it("refuses to confirm while an item has no one claiming it", async () => {
    const { groupId, ana, carl } = await setupGroup();
    const bill = await draftItemsBill(
      groupId,
      carl,
      [
        { name: "Pasta", priceCentavos: 20000 },
        { name: "Steak", priceCentavos: 35000 },
      ],
      55000,
    );
    const [pasta] = (await getBill(groupId, bill.id)).items;
    await app.inject({
      method: "POST",
      url: `/groups/${groupId}/expenses/${bill.id}/items/${pasta!.id}/claims`,
      payload: { memberId: ana },
    });

    const res = await app.inject({ method: "POST", url: `/groups/${groupId}/expenses/${bill.id}/confirm` });

    expect(res.statusCode).toBe(422);
    expect(res.json().unclaimed).toEqual(["Steak"]);
  });

  it("confirms once everything is claimed, and then refuses changes", async () => {
    const { groupId, ana, ben, carl } = await setupGroup();
    const bill = await draftItemsBill(
      groupId,
      carl,
      [
        { name: "Pasta", priceCentavos: 20000 },
        { name: "Steak", priceCentavos: 35000 },
      ],
      55000,
    );
    const [pasta, steak] = (await getBill(groupId, bill.id)).items;
    await app.inject({
      method: "POST",
      url: `/groups/${groupId}/expenses/${bill.id}/items/${pasta!.id}/claims`,
      payload: { memberId: ana },
    });
    await app.inject({
      method: "POST",
      url: `/groups/${groupId}/expenses/${bill.id}/items/${steak!.id}/claims`,
      payload: { memberId: ben },
    });

    const confirm = await app.inject({ method: "POST", url: `/groups/${groupId}/expenses/${bill.id}/confirm` });
    expect(confirm.statusCode).toBe(200);
    expect(confirm.json().status).toBe("confirmed");

    const change = await app.inject({
      method: "DELETE",
      url: `/groups/${groupId}/expenses/${bill.id}/items/${pasta!.id}/claims/${ana}`,
    });
    expect(change.statusCode).toBe(409);
  });

  it("can split the service fee equally between the people who ate", async () => {
    const { groupId, ana, ben, carl } = await setupGroup();

    // Pasta 200 (Ana), steak 350 (Ben), fee 55 shared equally: 27.50 each.
    const bill = await draftItemsBill(
      groupId,
      carl,
      [
        { name: "Pasta", priceCentavos: 20000, sharedByMemberIds: [ana] },
        { name: "Steak", priceCentavos: 35000, sharedByMemberIds: [ben] },
      ],
      60500,
      5500,
      "equal",
    );

    expect(bill.shares).toEqual({ [ana]: 22750, [ben]: 37750 });
  });
});