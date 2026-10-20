/**
 * routes/expenses.ts
 *
 * WHAT: Bills for a group.
 *   POST /groups/:groupId/expenses   add a bill and split it
 *   GET  /groups/:groupId/expenses   list bills, newest first
 * RULE: The server computes every share with @split/core. Clients never send
 *       the individual shares, so they can't fake them.
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

const groupParams = z.object({ groupId: z.string().uuid() });

const memberId = z.string().uuid();
const title = z.string().trim().min(1).max(100);
const totalCentavos = z.number().int().positive().max(100_000_000); // up to ₱1,000,000

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
    extrasCentavos: z.number().int().nonnegative().max(100_000_000),
    items: z
      .array(
        z.object({
          name: z.string().trim().min(1).max(100),
          priceCentavos: z.number().int().nonnegative().max(100_000_000),
          sharedByMemberIds: z.array(memberId).min(1).max(50),
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
  createdAt: Date;
};

/** Works out the shares for a validated bill, using @split/core. */
function computeShares(body: ExpenseBody, payerId: string): Shares {
  switch (body.splitMode) {
    case "equal":
      return splitEqual(body.totalCentavos, body.participantIds, payerId);
    case "amount":
      return splitByAmounts(body.totalCentavos, body.amounts);
    case "percent":
      return splitByPercent(body.totalCentavos, body.basisPoints, payerId);
    case "items": {
      const items: Item[] = body.items.map((item) => ({
        price: item.priceCentavos,
        sharedBy: item.sharedByMemberIds,
      }));
      const result = splitByItems(items, body.extrasCentavos, payerId);
      if (result.total !== body.totalCentavos) {
        throw new Error(
          `Items and extras add up to ${result.total}, but the bill total is ${body.totalCentavos}`,
        );
      }
      return result.shares;
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

export function registerExpenseRoutes(app: FastifyInstance, sql: Sql) {
  app.post("/groups/:groupId/expenses", async (request, reply) => {
    const params = groupParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "Invalid group id" });
    const body = expenseBody.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: "Invalid expense", issues: body.error.issues });
    }
    const { groupId } = params.data;
    const expense = body.data;

    // Every person in this bill must belong to this group.
    const involved = peopleInvolved(expense);
    const found = await sql<{ id: string }[]>`
      select id from members
      where group_id = ${groupId} and id in ${sql([...involved])}`;
    if (found.length !== involved.size) {
      const [group] = await sql`select 1 from groups where id = ${groupId}`;
      if (!group) return reply.code(404).send({ error: "Group not found" });
      return reply.code(404).send({ error: "Someone in this bill is not in this group" });
    }

    // The maths can refuse too (for example, percentages that don't add to 100%).
    let shares: Shares;
    try {
      shares = computeShares(expense, expense.paidByMemberId);
    } catch (err) {
      return reply.code(422).send({ error: err instanceof Error ? err.message : "Invalid split" });
    }

    // Save the bill, its items and every share together, or not at all.
    const saved = await sql.begin(async (tx) => {
      const [row] = await tx<ExpenseRow[]>`
        insert into expenses (group_id, paid_by_member_id, title, total_centavos, split_mode)
        values (${groupId}, ${expense.paidByMemberId}, ${expense.title},
                ${expense.totalCentavos}, ${expense.splitMode})
        returning id, title,
                  total_centavos    as "totalCentavos",
                  split_mode        as "splitMode",
                  paid_by_member_id as "paidByMemberId",
                  created_at        as "createdAt"`;

      if (expense.splitMode === "items") {
        for (const [position, item] of expense.items.entries()) {
          const [savedItem] = await tx<{ id: string }[]>`
            insert into expense_items (expense_id, name, price_centavos, position)
            values (${row!.id}, ${item.name}, ${item.priceCentavos}, ${position})
            returning id`;
          for (const memberId of item.sharedByMemberIds) {
            await tx`
              insert into expense_item_sharers (item_id, member_id)
              values (${savedItem!.id}, ${memberId})`;
          }
        }
      }

      for (const [id, amount] of Object.entries(shares)) {
        if (amount === 0) continue; // nothing owed, nothing to store
        await tx`
          insert into expense_shares (expense_id, member_id, amount_centavos)
          values (${row!.id}, ${id}, ${amount})`;
      }
      return row!;
    });

    return reply.code(201).send({ ...saved, shares });
  });

  app.get("/groups/:groupId/expenses", async (request, reply) => {
    const params = groupParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "Invalid group id" });
    const { groupId } = params.data;

    const [group] = await sql`select 1 from groups where id = ${groupId}`;
    if (!group) return reply.code(404).send({ error: "Group not found" });

    const expenses = await sql<ExpenseRow[]>`
      select id, title,
             total_centavos    as "totalCentavos",
             split_mode        as "splitMode",
             paid_by_member_id as "paidByMemberId",
             created_at        as "createdAt"
      from expenses
      where group_id = ${groupId}
      order by created_at desc, id desc`;
    return expenses;
  });
}
