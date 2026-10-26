/**
 * routes/payments.ts
 *
 * WHAT: Cash payments between members. The app works out how much you owe, and you attach
 *       the GCash receipt when you pay. The receiver then confirms or disputes.
 *   POST /groups/:groupId/payments                         record a payment to someone you owe (amount is worked out for you)
 *   GET  /groups/:groupId/payments                         list payments (members only)
 *   POST /groups/:groupId/payments/:paymentId/confirm      receiver: "I got it" (needs a receipt attached)
 *   POST /groups/:groupId/payments/:paymentId/dispute      receiver: "I didn't get it"
 *   POST /groups/:groupId/payments/:paymentId/proof        sender: attach the receipt (once, or again after a dispute)
 *   GET  /groups/:groupId/payments/:paymentId/proof        members: view the receipt
 * STATUS FLOW: pending -> confirmed
 *              pending -> disputed -> (sender attaches a receipt) -> pending
 * RULES: Only the sender can create a payment or attach a receipt. Only the receiver can
 *        confirm or dispute. Everyone in the group can see payments.
 *        The amount is the suggested payment from the group's balances, so people can't
 *        pay more or less than they owe. Pending payments count, disputed ones don't.
 *        Receipts are PNG or JPEG only, up to 2 MB. Confirmed receipts are deleted after 3 days (see receipts.ts).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { computeBalances, settleGreedy, type Expense, type Payment } from "@split/core";
import type { Sql } from "../db";
import { accessIn } from "../access";
import { recordEvent } from "../audit";

const PROOF_MAX_BYTES = 2 * 1024 * 1024;
const UNIQUE_VIOLATION = "23505";

const groupParams = z.object({ groupId: z.string().uuid() });
const paymentParams = groupParams.extend({ paymentId: z.string().uuid() });

// No amount here: the server works it out from what the sender owes.
const newPayment = z.object({
  toMemberId: z.string().uuid(),
  reference: z.string().trim().min(4).max(40),
});

type PaymentRow = {
  id: string;
  fromMemberId: string;
  toMemberId: string;
  status: string;
  hasProof: boolean;
};

function pgCode(err: unknown): string | undefined {
  if (typeof err === "object" && err !== null && "code" in err && typeof err.code === "string") {
    return err.code;
  }
  return undefined;
}

/**
 * How much `fromId` should send `toId` right now, from the group's balances.
 * Confirmed bills count. Pending and confirmed payments count. Disputed and rejected ones don't.
 * Returns 0 if `fromId` owes `toId` nothing.
 */
export async function amountOwed(sql: Sql, groupId: string, fromId: string, toId: string): Promise<number> {
  const bills = await sql<{ id: string; payerId: string; total: number }[]>`
    select id, paid_by_member_id as "payerId", total_centavos as total
    from expenses where group_id = ${groupId} and status = 'confirmed'`;
  const shareRows = await sql<{ expenseId: string; memberId: string; amount: number }[]>`
    select s.expense_id as "expenseId", s.member_id as "memberId", s.amount_centavos as amount
    from expense_shares s join expenses e on e.id = s.expense_id
    where e.group_id = ${groupId} and e.status = 'confirmed'`;
  const payRows = await sql<
    { id: string; fromId: string; toId: string; mode: "reimburse" | "treat"; status: "pending" | "confirmed" }[]
  >`
    select id, from_member_id as "fromId", to_member_id as "toId", mode, status
    from payments where group_id = ${groupId} and status in ('pending', 'confirmed')`;
  const allocRows = await sql<{ paymentId: string; debtorId: string; amount: number }[]>`
    select a.payment_id as "paymentId", a.debtor_member_id as "debtorId", a.amount_centavos as amount
    from payment_allocations a join payments p on p.id = a.payment_id
    where p.group_id = ${groupId} and p.status in ('pending', 'confirmed')`;

  const expenses: Expense[] = bills.map((bill) => {
    const shares: Record<string, number> = {};
    for (const s of shareRows) if (s.expenseId === bill.id) shares[s.memberId] = s.amount;
    return { payerId: bill.payerId, total: bill.total, shares };
  });
  const payments: Payment[] = payRows.map((pay) => ({
    fromId: pay.fromId,
    toId: pay.toId,
    mode: pay.mode,
    status: pay.status,
    allocations: allocRows
      .filter((a) => a.paymentId === pay.id)
      .map((a) => ({ debtorId: a.debtorId, amount: a.amount })),
  }));

  const plan = settleGreedy(computeBalances(expenses, payments));
  return plan.find((t) => t.fromId === fromId && t.toId === toId)?.amount ?? 0;
}

export function registerPaymentRoutes(app: FastifyInstance, sql: Sql) {
  // Receipts arrive as raw image bytes, not JSON. Fastify keeps them as a Buffer.
  app.addContentTypeParser(
    ["image/png", "image/jpeg"],
    { parseAs: "buffer", bodyLimit: PROOF_MAX_BYTES },
    (_request, body, done) => done(null, body),
  );

  app.post("/groups/:groupId/payments", async (request, reply) => {
    const params = groupParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "Invalid group id" });
    const { groupId } = params.data;

    const who = await accessIn(sql, request, groupId);
    if (!who.ok) return reply.code(who.code).send({ error: who.error });

    const body = newPayment.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({
        error: "Pick who you're paying and enter the reference number (at least 4 characters)",
        issues: body.error.issues,
      });
    }
    const p = body.data;

    if (p.toMemberId === who.memberId) {
      return reply.code(400).send({ error: "You can't pay yourself" });
    }
    const [inGroup] = await sql<{ id: string }[]>`
      select id from members where group_id = ${groupId} and id = ${p.toMemberId}`;
    if (!inGroup) return reply.code(422).send({ error: "That person isn't in this group" });

    const amount = await amountOwed(sql, groupId, who.memberId, p.toMemberId);
    if (amount <= 0) {
      return reply.code(422).send({ error: "You don't owe this person anything right now" });
    }

    try {
      const payment = await sql.begin(async (tx) => {
        const [row] = await tx<{ id: string }[]>`
          insert into payments (group_id, from_member_id, to_member_id, mode, reference)
          values (${groupId}, ${who.memberId}, ${p.toMemberId}, 'reimburse', ${p.reference})
          returning id`;
        await tx`
          insert into payment_allocations (payment_id, debtor_member_id, amount_centavos)
          values (${row!.id}, ${who.memberId}, ${amount})`;
        return row!;
      });
      await recordEvent(sql, groupId, "payment_recorded", who.memberId, payment.id);
      return reply.code(201).send({ id: payment.id, status: "pending", amountCentavos: amount });
    } catch (err) {
      if (pgCode(err) === UNIQUE_VIOLATION) {
        return reply.code(409).send({ error: "That reference number was already used in this group" });
      }
      throw err;
    }
  });

  app.get("/groups/:groupId/payments", async (request, reply) => {
    const params = groupParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "Invalid group id" });
    const { groupId } = params.data;

    const who = await accessIn(sql, request, groupId);
    if (!who.ok) return reply.code(who.code).send({ error: who.error });

    const payments = await sql<
      {
        id: string;
        fromMemberId: string;
        toMemberId: string;
        mode: string;
        status: string;
        reference: string;
        createdAt: Date;
        hasProof: boolean;
      }[]
    >`
      select id, from_member_id as "fromMemberId", to_member_id as "toMemberId",
             mode, status, reference, created_at as "createdAt",
             (proof is not null) as "hasProof"
      from payments where group_id = ${groupId}
      order by created_at desc`;

    const allocations = await sql<
      { paymentId: string; debtorMemberId: string; amountCentavos: number }[]
    >`
      select a.payment_id as "paymentId", a.debtor_member_id as "debtorMemberId",
             a.amount_centavos as "amountCentavos"
      from payment_allocations a join payments p on p.id = a.payment_id
      where p.group_id = ${groupId}`;

    return payments.map((pay) => {
      const mine = allocations.filter((a) => a.paymentId === pay.id);
      return {
        ...pay,
        totalCentavos: mine.reduce((sum, a) => sum + a.amountCentavos, 0),
        allocations: mine.map(({ debtorMemberId, amountCentavos }) => ({ debtorMemberId, amountCentavos })),
      };
    });
  });

  /** Shared by confirm and dispute: only the receiver, only while the payment is pending. */
  async function receiverDecides(
    request: FastifyRequest,
    reply: FastifyReply,
    to: "confirmed" | "disputed",
  ) {
    const params = paymentParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "Invalid id" });
    const { groupId, paymentId } = params.data;

    const who = await accessIn(sql, request, groupId);
    if (!who.ok) return reply.code(who.code).send({ error: who.error });

    const [payment] = await sql<PaymentRow[]>`
      select id, from_member_id as "fromMemberId", to_member_id as "toMemberId", status,
             (proof is not null) as "hasProof"
      from payments where id = ${paymentId} and group_id = ${groupId}`;
    if (!payment) return reply.code(404).send({ error: "Payment not found" });
    if (payment.toMemberId !== who.memberId) {
      return reply.code(403).send({ error: "Only the person who received the money can answer this" });
    }
    // You can't confirm money without the receipt in front of you.
    if (to === "confirmed" && !payment.hasProof) {
      return reply.code(409).send({ error: "The sender hasn't attached the receipt yet" });
    }

    const [updated] = await sql<{ id: string }[]>`
      update payments set status = ${to}, decided_at = now()
      where id = ${paymentId} and status = 'pending'
      returning id`;
    if (!updated) {
      return reply.code(409).send({ error: "This payment isn't waiting for an answer right now" });
    }
    await recordEvent(
      sql,
      groupId,
      to === "confirmed" ? "payment_confirmed" : "payment_disputed",
      who.memberId,
      paymentId,
    );
    return { id: paymentId, status: to };
  }

  app.post("/groups/:groupId/payments/:paymentId/confirm", (request, reply) =>
    receiverDecides(request, reply, "confirmed"),
  );

  app.post("/groups/:groupId/payments/:paymentId/dispute", (request, reply) =>
    receiverDecides(request, reply, "disputed"),
  );

  app.post("/groups/:groupId/payments/:paymentId/proof", async (request, reply) => {
    const params = paymentParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "Invalid id" });
    const { groupId, paymentId } = params.data;

    const who = await accessIn(sql, request, groupId);
    if (!who.ok) return reply.code(who.code).send({ error: who.error });

    const [payment] = await sql<PaymentRow[]>`
      select id, from_member_id as "fromMemberId", to_member_id as "toMemberId", status,
             (proof is not null) as "hasProof"
      from payments where id = ${paymentId} and group_id = ${groupId}`;
    if (!payment) return reply.code(404).send({ error: "Payment not found" });
    if (payment.fromMemberId !== who.memberId) {
      return reply.code(403).send({ error: "Only the person who sent the money can attach a receipt" });
    }

    const type = request.headers["content-type"];
    const bytes = request.body;
    if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
      return reply.code(400).send({ error: "Attach a PNG or JPEG screenshot" });
    }

    // A receipt can be attached once when paying, or again after a dispute.
    const [updated] = await sql<{ id: string }[]>`
      update payments set proof = ${bytes}, proof_type = ${type ?? null}, status = 'pending'
      where id = ${paymentId}
        and (status = 'disputed' or (status = 'pending' and proof is null))
      returning id`;
    if (!updated) {
      return reply.code(409).send({ error: "This payment already has a receipt" });
    }
    await recordEvent(sql, groupId, "proof_attached", who.memberId, paymentId);
    return { id: paymentId, status: "pending" };
  });

  app.get("/groups/:groupId/payments/:paymentId/proof", async (request, reply) => {
    const params = paymentParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "Invalid id" });
    const { groupId, paymentId } = params.data;

    const who = await accessIn(sql, request, groupId);
    if (!who.ok) return reply.code(who.code).send({ error: who.error });

    const [row] = await sql<{ proof: Buffer; proofType: string }[]>`
      select proof, proof_type as "proofType" from payments
      where id = ${paymentId} and group_id = ${groupId} and proof is not null`;
    if (!row) return reply.code(404).send({ error: "No receipt attached" });

    return reply.header("content-type", row.proofType).header("cache-control", "private, no-store").send(row.proof);
  });
}
