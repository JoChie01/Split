/**
 * audit.test.ts
 *
 * WHAT: Checks that important actions leave a row in the audit log.
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

function as(cookie: string, opts: InjectOptions) {
  return app.inject({ ...opts, headers: { cookie } });
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
});

/** Carl owns "Trip" and has added Walt by name. Returns ids. */
async function makeGroup() {
  const group = await as(carlCookie, { method: "POST", url: "/groups", payload: { name: "Trip", yourName: "Carl" } });
  const groupId = group.json().id as string;
  const details = await as(carlCookie, { method: "GET", url: `/groups/${groupId}` });
  const carl = details.json().members.find((m: { isYou: boolean }) => m.isYou).id as string;
  const walt = (
    await as(carlCookie, { method: "POST", url: `/groups/${groupId}/members`, payload: { displayName: "Walt" } })
  ).json().id as string;
  return { groupId, carl, walt };
}

async function actionsFor(groupId: string): Promise<string[]> {
  const rows = await sql<{ action: string }[]>`
    select action from audit_events where group_id = ${groupId} order by created_at`;
  return rows.map((r) => r.action);
}

describe("audit log", () => {
  it("records when a link is made", async () => {
    const { groupId } = await makeGroup();

    await as(carlCookie, { method: "POST", url: `/groups/${groupId}/links`, payload: { seatLimit: 5 } });

    expect(await actionsFor(groupId)).toContain("link_created");
  });

  it("records when a seat is removed", async () => {
    const { groupId, walt } = await makeGroup();

    await as(carlCookie, { method: "DELETE", url: `/groups/${groupId}/members/${walt}` });

    expect(await actionsFor(groupId)).toContain("member_removed");
  });

  it("records when a bill is confirmed", async () => {
    const { groupId, carl, walt } = await makeGroup();
    const bill = await as(carlCookie, {
      method: "POST",
      url: `/groups/${groupId}/expenses`,
      payload: {
        title: "Merienda",
        paidByMemberId: carl,
        totalCentavos: 10000,
        splitMode: "equal",
        participantIds: [carl, walt],
      },
    });

    await as(carlCookie, { method: "POST", url: `/groups/${groupId}/expenses/${bill.json().id}/confirm` });

    expect(await actionsFor(groupId)).toContain("bill_confirmed");
  });
});
