/**
 * payments.test.ts
 *
 * WHAT: Tests for cash payments: the amount worked out for you, the receipt attached when paying,
 *       confirm and dispute, and receipt cleanup.
 * RUN:  npm test (from apps/api)
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance, InjectOptions } from "fastify";
import { buildApp } from "./app";
import { createSql, type Sql } from "./db";
import { purgeExpiredReceipts } from "./receipts";
import { sessionCookie, takeSeat } from "./test-helpers";

const DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://localhost:5432/split_test";

// A tiny fake PNG: the server only checks the type and size, not the picture itself.
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

let app: FastifyInstance;
let sql: Sql;
let carlCookie = "";
let anaCookie = "";
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
  await sql`truncate groups cascade`;
  carlCookie = await sessionCookie(sql, "carl@example.com");
  anaCookie = await sessionCookie(sql, "ana@example.com");
  benCookie = await sessionCookie(sql, "ben@example.com");
  danCookie = await sessionCookie(sql, "dan@example.com");
});

/**
 * Carl owns "Trip". Carl paid a confirmed 750 bill split three ways, so Ana and Ben
 * each owe Carl 250. Ana and Ben have joined their seats.
 */
async function makeGroup() {
  const group = await as(carlCookie, { method: "POST", url: "/groups", payload: { name: "Trip", yourName: "Carl" } });
  const groupId = group.json().id as string;
  const details = await as(carlCookie, { method: "GET", url: `/groups/${groupId}` });
  const carl = details.json().members.find((m: { isYou: boolean }) => m.isYou).id as string;
  const ana = (
    await as(carlCookie, { method: "POST", url: `/groups/${groupId}/members`, payload: { displayName: "Ana" } })
  ).json().id as string;
  const ben = (
    await as(carlCookie, { method: "POST", url: `/groups/${groupId}/members`, payload: { displayName: "Ben" } })
  ).json().id as string;
  await takeSeat(sql, ana, "ana@example.com");
  await takeSeat(sql, ben, "ben@example.com");

  const bill = await as(carlCookie, {
    method: "POST",
    url: `/groups/${groupId}/expenses`,
    payload: {
      title: "Merienda",
      paidByMemberId: carl,
      totalCentavos: 75000,
      splitMode: "equal",
      participantIds: [carl, ana, ben],
    },
  });
  await as(carlCookie, { method: "POST", url: `/groups/${groupId}/expenses/${bill.json().id}/confirm` });

  return { groupId, carl, ana, ben };
}

/** Someone pays Carl. The amount is worked out by the server, not sent. */
async function pay(cookie: string, groupId: string, toMemberId: string, reference = "GC-1234567") {
  return as(cookie, {
    method: "POST",
    url: `/groups/${groupId}/payments`,
    payload: { toMemberId, reference },
  });
}

/** Attaches a receipt image as the sender. */
async function attachReceipt(cookie: string, groupId: string, paymentId: string) {
  return app.inject({
    method: "POST",
    url: `/groups/${groupId}/payments/${paymentId}/proof`,
    headers: { cookie, "content-type": "image/png" },
    payload: PNG,
  });
}

describe("recording a payment", () => {
  it("works out the amount from what is owed, and records it as pending", async () => {
    const { groupId, carl } = await makeGroup();

    const res = await pay(anaCookie, groupId, carl);

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ status: "pending", amountCentavos: 25000 });
    const list = await as(carlCookie, { method: "GET", url: `/groups/${groupId}/payments` });
    expect(list.json()[0]).toMatchObject({ reference: "GC-1234567", status: "pending", totalCentavos: 25000 });
  });

  it("ignores any amount sent with the payment", async () => {
    const { groupId, carl } = await makeGroup();

    const res = await as(anaCookie, {
      method: "POST",
      url: `/groups/${groupId}/payments`,
      payload: { toMemberId: carl, reference: "GC-1234567", amountCentavos: 1 },
    });

    expect(res.json().amountCentavos).toBe(25000);
  });

  it("refuses when you don't owe the person anything", async () => {
    const { groupId, ana } = await makeGroup();

    // Carl is owed money by the group, so he owes Ana nothing.
    const res = await pay(carlCookie, groupId, ana);

    expect(res.statusCode).toBe(422);
  });

  it("refuses a reference that is too short", async () => {
    const { groupId, carl } = await makeGroup();

    const res = await pay(anaCookie, groupId, carl, "123");

    expect(res.statusCode).toBe(400);
  });

  it("refuses a reference that was already used in the group, in any letter case", async () => {
    const { groupId, carl } = await makeGroup();
    await pay(anaCookie, groupId, carl, "GC-ABCD1234");

    const res = await pay(benCookie, groupId, carl, "gc-abcd1234");

    expect(res.statusCode).toBe(409);
  });

  it("you can't pay yourself", async () => {
    const { groupId, ana } = await makeGroup();

    const res = await pay(anaCookie, groupId, ana);

    expect(res.statusCode).toBe(400);
  });

  it("someone outside the group can't see or record payments", async () => {
    const { groupId, carl } = await makeGroup();

    const list = await as(danCookie, { method: "GET", url: `/groups/${groupId}/payments` });
    const record = await pay(danCookie, groupId, carl, "GC-ZZZZ9999");

    expect(list.statusCode).toBe(404);
    expect(record.statusCode).toBe(404);
  });
});

describe("receipt attached when paying", () => {
  it("the sender attaches the receipt straight after paying", async () => {
    const { groupId, carl } = await makeGroup();
    const { id } = (await pay(anaCookie, groupId, carl)).json();

    const res = await attachReceipt(anaCookie, groupId, id);

    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("pending");
  });

  it("a receipt can't be replaced while the payment is pending", async () => {
    const { groupId, carl } = await makeGroup();
    const { id } = (await pay(anaCookie, groupId, carl)).json();
    await attachReceipt(anaCookie, groupId, id);

    const res = await attachReceipt(anaCookie, groupId, id);

    expect(res.statusCode).toBe(409);
  });

  it("only the sender can attach a receipt", async () => {
    const { groupId, carl } = await makeGroup();
    const { id } = (await pay(anaCookie, groupId, carl)).json();

    const res = await attachReceipt(carlCookie, groupId, id);

    expect(res.statusCode).toBe(403);
  });

  it("refuses a file that isn't a PNG or JPEG", async () => {
    const { groupId, carl } = await makeGroup();
    const { id } = (await pay(anaCookie, groupId, carl)).json();

    const res = await app.inject({
      method: "POST",
      url: `/groups/${groupId}/payments/${id}/proof`,
      headers: { cookie: anaCookie, "content-type": "application/pdf" },
      payload: PNG,
    });

    expect(res.statusCode).toBe(415);
  });
});

describe("the receiver answers", () => {
  it("can't confirm until the receipt is attached", async () => {
    const { groupId, carl } = await makeGroup();
    const { id } = (await pay(anaCookie, groupId, carl)).json();

    const res = await as(carlCookie, { method: "POST", url: `/groups/${groupId}/payments/${id}/confirm` });

    expect(res.statusCode).toBe(409);
  });

  it("confirms once the receipt is there, and can't confirm twice", async () => {
    const { groupId, carl } = await makeGroup();
    const { id } = (await pay(anaCookie, groupId, carl)).json();
    await attachReceipt(anaCookie, groupId, id);

    const first = await as(carlCookie, { method: "POST", url: `/groups/${groupId}/payments/${id}/confirm` });
    const second = await as(carlCookie, { method: "POST", url: `/groups/${groupId}/payments/${id}/confirm` });

    expect(first.json().status).toBe("confirmed");
    expect(second.statusCode).toBe(409);
  });

  it("the sender can't confirm their own payment", async () => {
    const { groupId, carl } = await makeGroup();
    const { id } = (await pay(anaCookie, groupId, carl)).json();
    await attachReceipt(anaCookie, groupId, id);

    const res = await as(anaCookie, { method: "POST", url: `/groups/${groupId}/payments/${id}/confirm` });

    expect(res.statusCode).toBe(403);
  });

  it("a dispute marks the payment disputed, and it can't be confirmed while disputed", async () => {
    const { groupId, carl } = await makeGroup();
    const { id } = (await pay(anaCookie, groupId, carl)).json();
    await attachReceipt(anaCookie, groupId, id);

    await as(carlCookie, { method: "POST", url: `/groups/${groupId}/payments/${id}/dispute` });
    const confirmWhileDisputed = await as(carlCookie, {
      method: "POST",
      url: `/groups/${groupId}/payments/${id}/confirm`,
    });

    expect(confirmWhileDisputed.statusCode).toBe(409);
  });
});

describe("receipt after a dispute", () => {
  it("the sender attaches a new receipt after a dispute, and it goes back to pending", async () => {
    const { groupId, carl } = await makeGroup();
    const { id } = (await pay(anaCookie, groupId, carl)).json();
    await attachReceipt(anaCookie, groupId, id);
    await as(carlCookie, { method: "POST", url: `/groups/${groupId}/payments/${id}/dispute` });

    const res = await attachReceipt(anaCookie, groupId, id);

    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("pending");
  });

  it("members can view the receipt, and outsiders can't", async () => {
    const { groupId, carl } = await makeGroup();
    const { id } = (await pay(anaCookie, groupId, carl)).json();
    await attachReceipt(anaCookie, groupId, id);

    const member = await app.inject({
      method: "GET",
      url: `/groups/${groupId}/payments/${id}/proof`,
      headers: { cookie: carlCookie },
    });
    const outsider = await app.inject({
      method: "GET",
      url: `/groups/${groupId}/payments/${id}/proof`,
      headers: { cookie: danCookie },
    });

    expect(member.statusCode).toBe(200);
    expect(member.headers["content-type"]).toBe("image/png");
    expect(member.rawPayload.equals(PNG)).toBe(true);
    expect(outsider.statusCode).toBe(404);
  });
});

describe("receipt cleanup", () => {
  it("deletes the receipt of a confirmed payment 3 days after it was confirmed", async () => {
    const { groupId, carl } = await makeGroup();
    const { id } = (await pay(anaCookie, groupId, carl)).json();
    await attachReceipt(anaCookie, groupId, id);
    await as(carlCookie, { method: "POST", url: `/groups/${groupId}/payments/${id}/confirm` });
    await sql`update payments set decided_at = now() - interval '4 days' where id = ${id}`;

    const cleared = await purgeExpiredReceipts(sql);
    const after = await as(carlCookie, { method: "GET", url: `/groups/${groupId}/payments/${id}/proof` });

    expect(cleared).toBe(1);
    expect(after.statusCode).toBe(404);
  });

  it("keeps the receipt of a disputed payment, however old", async () => {
    const { groupId, carl } = await makeGroup();
    const { id } = (await pay(anaCookie, groupId, carl)).json();
    await attachReceipt(anaCookie, groupId, id);
    await as(carlCookie, { method: "POST", url: `/groups/${groupId}/payments/${id}/dispute` });
    await sql`update payments set decided_at = now() - interval '30 days' where id = ${id}`;

    const cleared = await purgeExpiredReceipts(sql);
    const after = await as(carlCookie, { method: "GET", url: `/groups/${groupId}/payments/${id}/proof` });

    expect(cleared).toBe(0);
    expect(after.statusCode).toBe(200);
  });

  it("keeps the payment record itself after its receipt is deleted", async () => {
    const { groupId, carl } = await makeGroup();
    const { id } = (await pay(anaCookie, groupId, carl)).json();
    await attachReceipt(anaCookie, groupId, id);
    await as(carlCookie, { method: "POST", url: `/groups/${groupId}/payments/${id}/confirm` });
    await sql`update payments set decided_at = now() - interval '4 days' where id = ${id}`;
    await purgeExpiredReceipts(sql);

    const list = await as(carlCookie, { method: "GET", url: `/groups/${groupId}/payments` });

    expect(list.json()[0]).toMatchObject({ status: "confirmed", totalCentavos: 25000, hasProof: false });
  });
});
