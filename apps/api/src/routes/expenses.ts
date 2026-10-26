/**
 * routes/expenses.ts
 *
 * WHAT: Bills for a group, from draft to confirmed. Members only.
 *   POST   /groups/:groupId/expenses                                    add a draft bill
 *   GET    /groups/:groupId/expenses                                    list bills
 *   GET    /groups/:groupId/expenses/:expenseId                         one bill, with items and claims
 *   POST   /groups/:groupId/expenses/:expenseId/items/:itemId/claims    claim an item (for yourself)
 *   DELETE /groups/:groupId/expenses/:expenseId/items/:itemId/claims/:memberId   unclaim it (your own)
 *   POST   /groups/:groupId/expenses/:expenseId/confirm                 lock the bill (payer only)
 * RULES: Shares are always computed on the server with @split/core.
 *        Drafts can change. Confirmed bills cannot.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  splitByAmounts,
  splitByItems,
  splitByPercent,
  splitEqual,
  type Item,
  type Shares,
} from "@split/core";
import type { Sql } from "../db";
import { accessIn } from "../access";
import { recordEvent } from "../audit";

const groupParams = z.object({ groupId: z.string().uuid() });
const expenseParams = groupParams.extend({ expenseId: z.string().uuid() });
const itemParams = expenseParams.extend({ itemId: z.string().uuid() });
const claimParams = itemParams.extend({ memberId: z.string().uuid() });
const claimBody = z.object({ memberId: z.string().uuid() });

const memberId = z.string().uuid();
const title = z.string().trim().min(1).max(100);
const totalCentavos = z.number().int().positive().max(100_000_000); // up to ₱1,000,000
const centavos = z.number().int().nonnegative().max(100_000_000);

const expenseBody = z.discriminatedUnion("splitMode", [
  z.object({
    title,
    paidByMemberId: memberId,
    totalCentavos,
    splitMode: z.literal("equal"),
    participantIds: z.array(memberId).min(1).max(50),
  }),
  z.object({
    title,
    paidByMemberId: memberId,
    totalCentavos,
    splitMode: z.literal("amount"),
    amounts: z.record(memberId, z.number().int().nonnegative()),
  }),
  z.object({
    title,
    paidByMemberId: memberId,
    totalCentavos,
    splitMode: z.literal("percent"),
    basisPoints: z.record(memberId, z.number().int().positive()),
  }),
  z.object({
    title,
    paidByMemberId: memberId,
    totalCentavos,
    splitMode: z.literal("items"),
    extrasCentavos: centavos,
    extrasMode: z.enum(["proportional", "equal"]).default("proportional"),
    items: z
      .array(
        z.object({
          name: z.string().trim().min(1).max(100),
          priceCentavos: centavos,
          // Empty is allowed: the item can be claimed later.
          sharedByMemberIds: z.array(memberId).max(50),
        }),
      )
      .min(1)
      .max(100),
  }),
]);

type ExpenseBody = z.infer<typeof expenseBody>;

type ExpenseRow = {
  id: string;
  title: string;
  totalCentavos: number;
  splitMode: string;
  paidByMemberId: string;
  status: string;
  extrasCentavos: number;
  extrasMode: string;
  createdAt: Date;
};

type ItemWithClaims = {
  id: string;
  name: string;
  priceCentavos: number;
  position: number;
  claimedBy: string[];
};

export type ClaimResult =
  | { ok: true; shares: Shares }
  | { ok: false; code: number; error: string };

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : "Invalid split";
}

/**
 * The shares for a set of items. Items nobody has claimed yet don't count.
 * Proportional: the fee is shared by food total (splitByItems does this).
 * Equal: everyone who ate pays the same share of the fee.
 */
function shareItems(items: Item[], extras: number, extrasMode: string, payerId: string): Shares {
  const claimed = items.filter((item) => item.sharedBy.length > 0);
  if (claimed.length === 0) return {};

  const food = splitByItems(claimed, extrasMode === "proportional" ? extras : 0, payerId).shares;
  if (extrasMode === "proportional" || extras === 0) return food;

  const shares: Shares = { ...food };
  const feeShares = splitEqual(extras, Object.keys(food), payerId);
  for (const [id, amount] of Object.entries(feeShares)) {
    shares[id] = (shares[id] ?? 0) + amount;
  }
  return shares;
}

/** The items and fee must add up to the bill total (unclaimed items included). */
function itemsAddUp(items: { priceCentavos: number }[], extras: number, total: number): boolean {
  return items.reduce((sum, item) => sum + item.priceCentavos, 0) + extras === total;
}

/** Works out the shares for a validated bill, using @split/core. */
function computeShares(body: ExpenseBody): Shares {
  switch (body.splitMode) {
    case "equal":
      return splitEqual(body.totalCentavos, body.participantIds, body.paidByMemberId);
    case "amount":
      return splitByAmounts(body.totalCentavos, body.amounts);
    case "percent":
      return splitByPercent(body.totalCentavos, body.basisPoints, body.paidByMemberId);
    case "items": {
      if (!itemsAddUp(body.items, body.extrasCentavos, body.totalCentavos)) {
        throw new Error("The items and extras must add up to the bill total");
      }
      return shareItems(
        body.items.map((item) => ({ price: item.priceCentavos, sharedBy: item.sharedByMemberIds })),
        body.extrasCentavos,
        body.extrasMode,
        body.paidByMemberId,
      );
    }
  }
}

/** Every person named in a bill, so we can check they all belong to the group. */
function peopleInvolved(body: ExpenseBody): Set<string> {
  const ids = new Set<string>([body.paidByMemberId]);
  switch (body.splitMode) {
    case "equal":
      body.participantIds.forEach((id) => ids.add(id));
      break;
    case "amount":
      Object.keys(body.amounts).forEach((id) => ids.add(id));
      break;
    case "percent":
      Object.keys(body.basisPoints).forEach((id) => ids.add(id));
      break;
    case "items":
      body.items.forEach((item) => item.sharedByMemberIds.forEach((id) => ids.add(id)));
      break;
  }
  return ids;
}

async function allInGroup(sql: Sql, groupId: string, ids: Set<string>): Promise<boolean> {
  if (ids.size === 0) return true;
  const found = await sql<{ id: string }[]>`
    select id from members
    where group_id = ${groupId} and id in ${sql([...ids])}`;
  return found.length === ids.size;
}

async function findExpense(sql: Sql, groupId: string, expenseId: string): Promise<ExpenseRow | undefined> {
  const [row] = await sql<ExpenseRow[]>`
    select id, title,
           total_centavos    as "totalCentavos",
           split_mode        as "splitMode",
           paid_by_member_id as "paidByMemberId",
           status,
           extras_centavos   as "extrasCentavos",
           extras_mode       as "extrasMode",
           created_at        as "createdAt"
    from expenses
    where id = ${expenseId} and group_id = ${groupId}`;
  return row;
}

/** The shares as they are saved now. */
async function storedShares(sql: Sql, expenseId: string): Promise<Shares> {
  const rows = await sql<{ memberId: string; amount: number }[]>`
    select member_id as "memberId", amount_centavos as amount
    from expense_shares where expense_id = ${expenseId}`;
  return Object.fromEntries(rows.map((row) => [row.memberId, row.amount]));
}

/** The items of a bill, each with the people who claimed it. */
export async function loadItems(sql: Sql, expenseId: string): Promise<ItemWithClaims[]> {
  const items = await sql<{ id: string; name: string; priceCentavos: number; position: number }[]>`
    select id, name, price_centavos as "priceCentavos", position
    from expense_items where expense_id = ${expenseId} order by position`;
  const claims = await sql<{ itemId: string; memberId: string }[]>`
    select c.item_id as "itemId", c.member_id as "memberId"
    from expense_item_sharers c
    join expense_items i on i.id = c.item_id
    where i.expense_id = ${expenseId}`;
  return items.map((item) => ({
    ...item,
    claimedBy: claims.filter((c) => c.itemId === item.id).map((c) => c.memberId),
  }));
}

/**
 * Adds or removes one person's claim on one item, and updates the shares.
 * The routes check who is asking; this function checks the bill rules.
 */
export async function changeClaim(
  sql: Sql,
  groupId: string,
  expenseId: string,
  itemId: string,
  memberId: string,
  claimed: boolean,
): Promise<ClaimResult> {
  const expense = await findExpense(sql, groupId, expenseId);
  if (!expense) return { ok: false, code: 404, error: "Bill not found" };
  if (expense.status !== "draft") {
    return { ok: false, code: 409, error: "This bill is confirmed and can't change" };
  }
  if (expense.splitMode !== "items") {
    return { ok: false, code: 409, error: "Only item bills can be claimed" };
  }

  const items = await loadItems(sql, expenseId);
  if (!items.some((item) => item.id === itemId)) {
    return { ok: false, code: 404, error: "Item not found" };
  }
  if (claimed && !(await allInGroup(sql, groupId, new Set([memberId])))) {
    return { ok: false, code: 404, error: "That person is not in this group" };
  }

  // Work out the new shares first, so a bad split is refused before anything is saved.
  const updated = items.map((item) => {
    if (item.id !== itemId) return item;
    const others = item.claimedBy.filter((id) => id !== memberId);
    return { ...item, claimedBy: claimed ? [...others, memberId] : others };
  });

  let shares: Shares;
  try {
    shares = shareItems(
      updated.map((item) => ({ price: item.priceCentavos, sharedBy: item.claimedBy })),
      expense.extrasCentavos,
      expense.extrasMode,
      expense.paidByMemberId,
    );
  } catch (err) {
    return { ok: false, code: 422, error: errorText(err) };
  }

  // The claim and the new shares are saved together, or not at all.
  await sql.begin(async (tx) => {
    if (claimed) {
      await tx`
        insert into expense_item_sharers (item_id, member_id)
        values (${itemId}, ${memberId})
        on conflict do nothing`;
    } else {
      await tx`
        delete from expense_item_sharers
        where item_id = ${itemId} and member_id = ${memberId}`;
    }
    await tx`delete from expense_shares where expense_id = ${expenseId}`;
    for (const [payee, amount] of Object.entries(shares)) {
      if (amount === 0) continue;
      await tx`
        insert into expense_shares (expense_id, member_id, amount_centavos)
        values (${expenseId}, ${payee}, ${amount})`;
    }
  });

  return { ok: true, shares: await storedShares(sql, expenseId) };
}

export function registerExpenseRoutes(app: FastifyInstance, sql: Sql) {
  app.post("/groups/:groupId/expenses", async (request, reply) => {
    const params = groupParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "Invalid group id" });
    const { groupId } = params.data;

    const who = await accessIn(sql, request, groupId);
    if (!who.ok) return reply.code(who.code).send({ error: who.error });

    const body = expenseBody.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: "Invalid expense", issues: body.error.issues });
    }
    const expense = body.data;

    if (!(await allInGroup(sql, groupId, peopleInvolved(expense)))) {
      return reply.code(404).send({ error: "Someone in this bill is not in this group" });
    }

    let shares: Shares;
    try {
      shares = computeShares(expense);
    } catch (err) {
      return reply.code(422).send({ error: errorText(err) });
    }

    const extrasCentavos = expense.splitMode === "items" ? expense.extrasCentavos : 0;
    const extrasMode = expense.splitMode === "items" ? expense.extrasMode : "proportional";

    // The bill, its items, its claims and its shares are saved together, or not at all.
    const saved = await sql.begin(async (tx) => {
      const [row] = await tx<ExpenseRow[]>`
        insert into expenses
          (group_id, paid_by_member_id, title, total_centavos, split_mode, status, extras_centavos, extras_mode)
        values
          (${groupId}, ${expense.paidByMemberId}, ${expense.title}, ${expense.totalCentavos},
           ${expense.splitMode}, 'draft', ${extrasCentavos}, ${extrasMode})
        returning id, title,
                  total_centavos    as "totalCentavos",
                  split_mode        as "splitMode",
                  paid_by_member_id as "paidByMemberId",
                  status,
                  extras_centavos   as "extrasCentavos",
                  extras_mode       as "extrasMode",
                  created_at        as "createdAt"`;

      if (expense.splitMode === "items") {
        for (const [position, item] of expense.items.entries()) {
          const [savedItem] = await tx<{ id: string }[]>`
            insert into expense_items (expense_id, name, price_centavos, position)
            values (${row!.id}, ${item.name}, ${item.priceCentavos}, ${position})
            returning id`;
          for (const claimer of item.sharedByMemberIds) {
            await tx`
              insert into expense_item_sharers (item_id, member_id)
              values (${savedItem!.id}, ${claimer})`;
          }
        }
      }

      for (const [payee, amount] of Object.entries(shares)) {
        if (amount === 0) continue;
        await tx`
          insert into expense_shares (expense_id, member_id, amount_centavos)
          values (${row!.id}, ${payee}, ${amount})`;
      }
      return row!;
    });

    return reply.code(201).send({ ...saved, shares });
  });

  app.get("/groups/:groupId/expenses", async (request, reply) => {
    const params = groupParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "Invalid group id" });
    const { groupId } = params.data;

    const who = await accessIn(sql, request, groupId);
    if (!who.ok) return reply.code(who.code).send({ error: who.error });

    return sql<ExpenseRow[]>`
      select id, title,
             total_centavos    as "totalCentavos",
             split_mode        as "splitMode",
             paid_by_member_id as "paidByMemberId",
             status,
             extras_centavos   as "extrasCentavos",
             extras_mode       as "extrasMode",
             created_at        as "createdAt"
      from expenses
      where group_id = ${groupId}
      order by created_at desc, id desc`;
  });

  app.get("/groups/:groupId/expenses/:expenseId", async (request, reply) => {
    const params = expenseParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "Invalid id" });
    const { groupId, expenseId } = params.data;

    const who = await accessIn(sql, request, groupId);
    if (!who.ok) return reply.code(who.code).send({ error: who.error });

    const expense = await findExpense(sql, groupId, expenseId);
    if (!expense) return reply.code(404).send({ error: "Bill not found" });

    return {
      ...expense,
      items: await loadItems(sql, expenseId),
      shares: await storedShares(sql, expenseId),
    };
  });

  app.post("/groups/:groupId/expenses/:expenseId/items/:itemId/claims", async (request, reply) => {
    const params = itemParams.safeParse(request.params);
    const body = claimBody.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "Invalid claim" });
    const { groupId, expenseId, itemId } = params.data;

    const who = await accessIn(sql, request, groupId);
    if (!who.ok) return reply.code(who.code).send({ error: who.error });
    // You can only claim items for yourself.
    if (body.data.memberId !== who.memberId) {
      return reply.code(403).send({ error: "You can only claim items for yourself" });
    }

    const result = await changeClaim(sql, groupId, expenseId, itemId, who.memberId, true);
    if (!result.ok) return reply.code(result.code).send({ error: result.error });
    return { shares: result.shares };
  });

  app.delete("/groups/:groupId/expenses/:expenseId/items/:itemId/claims/:memberId", async (request, reply) => {
    const params = claimParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "Invalid claim" });
    const { groupId, expenseId, itemId, memberId: claimer } = params.data;

    const who = await accessIn(sql, request, groupId);
    if (!who.ok) return reply.code(who.code).send({ error: who.error });
    if (claimer !== who.memberId) {
      return reply.code(403).send({ error: "You can only remove your own claims" });
    }

    const result = await changeClaim(sql, groupId, expenseId, itemId, who.memberId, false);
    if (!result.ok) return reply.code(result.code).send({ error: result.error });
    return { shares: result.shares };
  });

  app.post("/groups/:groupId/expenses/:expenseId/confirm", async (request, reply) => {
    const params = expenseParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "Invalid id" });
    const { groupId, expenseId } = params.data;

    const who = await accessIn(sql, request, groupId);
    if (!who.ok) return reply.code(who.code).send({ error: who.error });

    const expense = await findExpense(sql, groupId, expenseId);
    if (!expense) return reply.code(404).send({ error: "Bill not found" });
    if (expense.paidByMemberId !== who.memberId) {
      return reply.code(403).send({ error: "Only the person who paid can confirm this bill" });
    }
    if (expense.status !== "draft") {
      return reply.code(409).send({ error: "This bill is already confirmed" });
    }

    if (expense.splitMode === "items") {
      const unclaimed = await sql<{ name: string }[]>`
        select i.name from expense_items i
        where i.expense_id = ${expenseId}
          and not exists (select 1 from expense_item_sharers c where c.item_id = i.id)
        order by i.position`;
      if (unclaimed.length > 0) {
        return reply.code(422).send({
          error: "Some items have no one claiming them yet",
          unclaimed: unclaimed.map((item) => item.name),
        });
      }
    }

    await sql`update expenses set status = 'confirmed' where id = ${expenseId}`;
    await recordEvent(sql, groupId, "bill_confirmed", who.memberId, expenseId);
    return { status: "confirmed", shares: await storedShares(sql, expenseId) };
  });
}
