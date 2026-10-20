/**
 * routes/links.ts
 *
 * WHAT: Shareable links so people can claim their own items without an account.
 *   POST /groups/:groupId/links                                             make a link (7 days)
 *   GET  /join/:token                                                       group, members and bills
 *   POST /join/:token/expenses/:expenseId/items/:itemId/claims              claim an item
 *   DELETE /join/:token/expenses/:expenseId/items/:itemId/claims/:memberId  unclaim it
 * RULES: Links can claim, but never confirm. Only the payer confirms (group route).
 *        v1 TRUST: anyone with the link can claim as any member. Accounts come in milestone 5.
 *        Payment details are never shown on the join page.
 */
import { createHash, randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Sql } from "../db";
import { changeClaim, loadItems } from "./expenses";

const LINK_DAYS = 7;

const groupParams = z.object({ groupId: z.string().uuid() });
const tokenParams = z.object({ token: z.string().min(20).max(100) });
const joinItemParams = tokenParams.extend({
  expenseId: z.string().uuid(),
  itemId: z.string().uuid(),
});
const joinClaimParams = joinItemParams.extend({ memberId: z.string().uuid() });
const joinClaimBody = z.object({ memberId: z.string().uuid() });

/** We store only the hash, so the link itself exists only in the person's hands. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** The group a link opens, or undefined if the link is wrong or expired. */
async function groupForToken(sql: Sql, token: string): Promise<string | undefined> {
  const [row] = await sql<{ groupId: string }[]>`
    select group_id as "groupId" from group_links
    where token_hash = ${hashToken(token)} and expires_at > now()`;
  return row?.groupId;
}

export function registerLinkRoutes(app: FastifyInstance, sql: Sql) {
  app.post("/groups/:groupId/links", async (request, reply) => {
    const params = groupParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "Invalid group id" });
    const { groupId } = params.data;

    const [group] = await sql`select 1 from groups where id = ${groupId}`;
    if (!group) return reply.code(404).send({ error: "Group not found" });

    const token = randomBytes(32).toString("base64url");
    const [row] = await sql<{ expiresAt: Date }[]>`
      insert into group_links (token_hash, group_id, expires_at)
      values (${hashToken(token)}, ${groupId}, now() + make_interval(days => ${LINK_DAYS}))
      returning expires_at as "expiresAt"`;

    return reply.code(201).send({
      token,
      expiresAt: row!.expiresAt,
      note: "Share this link now. It can't be shown again.",
    });
  });

  app.get("/join/:token", async (request, reply) => {
    const params = tokenParams.safeParse(request.params);
    if (!params.success) return reply.code(404).send({ error: "Link not found or expired" });
    const groupId = await groupForToken(sql, params.data.token);
    if (!groupId) return reply.code(404).send({ error: "Link not found or expired" });

    const [group] = await sql<{ id: string; name: string }[]>`
      select id, name from groups where id = ${groupId}`;
    const members = await sql<{ id: string; displayName: string }[]>`
      select id, display_name as "displayName"
      from members where group_id = ${groupId}
      order by lower(display_name)`;
    const bills = await sql<
      { id: string; title: string; status: string; totalCentavos: number; splitMode: string }[]
    >`
      select id, title, status,
             total_centavos as "totalCentavos",
             split_mode     as "splitMode"
      from expenses where group_id = ${groupId}
      order by created_at desc, id desc`;

    return {
      group,
      members,
      expenses: await Promise.all(
        bills.map(async (bill) => ({
          ...bill,
          items: bill.splitMode === "items" ? await loadItems(sql, bill.id) : [],
        })),
      ),
    };
  });

  app.post("/join/:token/expenses/:expenseId/items/:itemId/claims", async (request, reply) => {
    const params = joinItemParams.safeParse(request.params);
    const body = joinClaimBody.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "Invalid claim" });
    const groupId = await groupForToken(sql, params.data.token);
    if (!groupId) return reply.code(404).send({ error: "Link not found or expired" });

    const { expenseId, itemId } = params.data;
    const result = await changeClaim(sql, groupId, expenseId, itemId, body.data.memberId, true);
    if (!result.ok) return reply.code(result.code).send({ error: result.error });
    return { shares: result.shares };
  });

  app.delete("/join/:token/expenses/:expenseId/items/:itemId/claims/:memberId", async (request, reply) => {
    const params = joinClaimParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "Invalid claim" });
    const groupId = await groupForToken(sql, params.data.token);
    if (!groupId) return reply.code(404).send({ error: "Link not found or expired" });

    const { expenseId, itemId, memberId } = params.data;
    const result = await changeClaim(sql, groupId, expenseId, itemId, memberId, false);
    if (!result.ok) return reply.code(result.code).send({ error: result.error });
    return { shares: result.shares };
  });
}