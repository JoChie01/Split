/**
 * payments.test.ts
 *
 * WHAT: Tests for cash payments with a reference number, confirm / dispute, and proof.
 * RUN:  npm test (from apps/api)
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance, InjectOptions } from "fastify";
import { buildApp } from "./app";
import { createSql, type Sql } from "./db";
import { sessionCookie, takeSeat } from "./test-helpers";

const DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://localhost:5432/split_test";

// A tiny fake PNG: the server only checks the type and size, not the picture itself.
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

let app: FastifyInstance;
let sql: Sql;
let carlCookie = "";
let anaCookie = "";
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
  danCookie = await sessionCookie(sql, "dan@example.com");
});

/** Carl owns "Trip" with Carl, Ana (joined as Ana) and Ben (name only). */
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
  return { groupId, carl, ana, ben };
}

/** Ana pays Carl back for her share. */
async function anaPaysCarl(groupId: string, carl: string, ana: string, reference = "GC-1234567") {
  return as(anaCookie, {
    method: "POST",
    url: `/groups/${groupId}/payments`,
    payload: {
      toMemberId: carl,
      mode: "reimburse",
      reference,
      allocations: [{ debtorMemberId: ana, amountCentavos: 25000 }],
    },
  });
}

describe("recording a payment", () => {
  it("the sender records a pending payment with a reference number", async () => {
    const { groupId, carl, ana } = await makeGroup();

    const res = await anaPaysCarl(groupId, carl, ana);

    expect(res.statusCode).toBe(201);
    expect(res.json().status).toBe("pending");
    const list = await as(carlCookie, { method: "GET", url: `/groups/${groupId}/payments` });
    expect(list.json()[0]).toMatchObject({ reference: "GC-1234567", status: "pending", totalCentavos: 25000 });
  });

  it("refuses a reference that is too short", async () => {
    const { groupId, carl, ana } = await makeGroup();

    const res = await anaPaysCarl(groupId, carl, ana, "123");

    expect(res.statusCode).toBe(400);
  });

  it("refuses a reference that was already used in the group, in any letter case", async () => {
    const { groupId, carl, ana } = await makeGroup();
    await anaPaysCarl(groupId, carl, ana, "GC-ABCD1234");

    const res = await anaPaysCarl(groupId, carl, ana, "gc-abcd1234");

    expect(res.statusCode).toBe(409);
  });

  it("you can't pay yourself", async () => {
    const { groupId, ana } = await makeGroup();

    const res = await anaPaysCarl(groupId, ana, ana);

    expect(res.statusCode).toBe(400);
  });

  it("someone outside the group can't see or record payments", async () => {
    const { groupId, carl, ana } = await makeGroup();

    const list = await as(danCookie, { method: "GET", url: `/groups/${groupId}/payments` });
    const record = await anaPaysCarl(groupId, carl, ana, "GC-ZZZZ9999");

    expect(list.statusCode).toBe(404);
    expect(record.statusCode).toBe(404);
  });
});

describe("the receiver answers", () => {
  it("the receiver confirms a pending payment, and can't confirm it twice", async () => {
    const { groupId, carl, ana } = await makeGroup();
    const { id } = (await anaPaysCarl(groupId, carl, ana)).json();

    const first = await as(carlCookie, { method: "POST", url: `/groups/${groupId}/payments/${id}/confirm` });
    const second = await as(carlCookie, { method: "POST", url: `/groups/${groupId}/payments/${id}/confirm` });

    expect(first.json().status).toBe("confirmed");
    expect(second.statusCode).toBe(409);
  });

  it("the sender can't confirm their own payment", async () => {
    const { groupId, carl, ana } = await makeGroup();
    const { id } = (await anaPaysCarl(groupId, carl, ana)).json();

    const res = await as(anaCookie, { method: "POST", url: `/groups/${groupId}/payments/${id}/confirm` });

    expect(res.statusCode).toBe(403);
  });

  it("a dispute marks the payment disputed until proof comes in", async () => {
    const { groupId, carl, ana } = await makeGroup();
    const { id } = (await anaPaysCarl(groupId, carl, ana)).json();

    await as(carlCookie, { method: "POST", url: `/groups/${groupId}/payments/${id}/dispute` });
    const confirmWhileDisputed = await as(carlCookie, {
      method: "POST",
      url: `/groups/${groupId}/payments/${id}/confirm`,
    });

    expect(confirmWhileDisputed.statusCode).toBe(409);
  });
});

describe("proof after a dispute", () => {
  it("the sender attaches a screenshot after a dispute, and it goes back to pending", async () => {
    const { groupId, carl, ana } = await makeGroup();
    const { id } = (await anaPaysCarl(groupId, carl, ana)).json();
    await as(carlCookie, { method: "POST", url: `/groups/${groupId}/payments/${id}/dispute` });

    const res = await app.inject({
      method: "POST",
      url: `/groups/${groupId}/payments/${id}/proof`,
      headers: { cookie: anaCookie, "content-type": "image/png" },
      payload: PNG,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("pending");
  });

  it("proof can't be attached when the payment isn't disputed", async () => {
    const { groupId, carl, ana } = await makeGroup();
    const { id } = (await anaPaysCarl(groupId, carl, ana)).json();

    const res = await app.inject({
      method: "POST",
      url: `/groups/${groupId}/payments/${id}/proof`,
      headers: { cookie: anaCookie, "content-type": "image/png" },
      payload: PNG,
    });

    expect(res.statusCode).toBe(409);
  });

  it("only the sender can attach proof", async () => {
    const { groupId, carl, ana } = await makeGroup();
    const { id } = (await anaPaysCarl(groupId, carl, ana)).json();
    await as(carlCookie, { method: "POST", url: `/groups/${groupId}/payments/${id}/dispute` });

    const res = await app.inject({
      method: "POST",
      url: `/groups/${groupId}/payments/${id}/proof`,
      headers: { cookie: carlCookie, "content-type": "image/png" },
      payload: PNG,
    });

    expect(res.statusCode).toBe(403);
  });

  it("refuses a file that isn't a PNG or JPEG", async () => {
    const { groupId, carl, ana } = await makeGroup();
    const { id } = (await anaPaysCarl(groupId, carl, ana)).json();
    await as(carlCookie, { method: "POST", url: `/groups/${groupId}/payments/${id}/dispute` });

    const res = await app.inject({
      method: "POST",
      url: `/groups/${groupId}/payments/${id}/proof`,
      headers: { cookie: anaCookie, "content-type": "application/pdf" },
      payload: PNG,
    });

    expect(res.statusCode).toBe(415);
  });

  it("members can view the screenshot, and outsiders can't", async () => {
    const { groupId, carl, ana } = await makeGroup();
    const { id } = (await anaPaysCarl(groupId, carl, ana)).json();
    await as(carlCookie, { method: "POST", url: `/groups/${groupId}/payments/${id}/dispute` });
    await app.inject({
      method: "POST",
      url: `/groups/${groupId}/payments/${id}/proof`,
      headers: { cookie: anaCookie, "content-type": "image/png" },
      payload: PNG,
    });

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
