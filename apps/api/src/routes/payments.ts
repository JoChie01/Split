/**
 * routes/payments.ts
 *
 * WHAT: Cash payments between members, with a reference number and a dispute path.
 *   POST /groups/:groupId/payments                         record a payment you sent (you are the sender)
 *   GET  /groups/:groupId/payments                         list payments (members only)
 *   POST /groups/:groupId/payments/:paymentId/confirm      receiver: "I got it"
 *   POST /groups/:groupId/payments/:paymentId/dispute      receiver: "I didn't get it" (asks for proof)
 *   POST /groups/:groupId/payments/:paymentId/proof        sender: attach a screenshot after a dispute
 *   GET  /groups/:groupId/payments/:paymentId/proof        members: view the screenshot
 * STATUS FLOW: pending -> confirmed
 *              pending -> disputed -> (sender attaches proof) -> pending
 * RULES: Only the sender can create a payment or attach proof. Only the receiver can
 *        confirm or dispute. Everyone in the group can see payments.
 *        Money amounts are whole centavos. Screenshots are PNG or JPEG only, up to 2 MB.
 * NOTE: Amounts are not yet checked against what each person owes. That check comes next.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Sql } from "../db";
import { accessIn } from "../access";

const PROOF_MAX_BYTES = 2 * 1024 * 1024;
const UNIQUE_VIOLATION = "23505";

const groupParams = z.object({ groupId: z.string().uuid() });
const paymentParams = groupParams.extend({ paymentId: z.string().uuid() });

const newPayment = z.object({
  toMemberId: z.string().uuid(),
  mode: z.enum(["reimburse", "treat"]),
  reference: z.string().trim().min(4).max(40),
  allocations: z
    .array(
      z.object({
        debtorMemberId: z.string().uuid(),
        amountCentavos: z.number().int().positive().max(100_000_000),
      }),
    )
    .min(1)
    .max(50),
});

type PaymentRow = {
  id: string;
  fromMemberId: string;
  toMemberId: string;
  status: string;
};

function pgCode(err: unknown): string | undefined {
  if (typeof err === "object" && err !== null && "code" in err && typeof err.code === "string") {
    return err.code;
  }
  return undefined;
}

export function registerPaymentRoutes(app: FastifyInstance, sql: Sql) {
  // Screenshots arrive as raw image bytes, not JSON. Fastify keeps them as a Buffer.
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
        error: "Check the payment: a reference of at least 4 characters and at least one amount",
        issues: body.error.issues,
      });
    }
    const p = body.data;

    if (p.toMemberId === who.memberId) {
      return reply.code(400).send({ error: "You can't pay yourself" });
    }
    const debtorIds = p.allocations.map((a) => a.debtorMemberId);
    if (new Set(debtorIds).size !== debtorIds.length) {
      return reply.code(400).send({ error: "Each person can appear only once in a payment" });
    }

    // Every person named must belong to this group.
    const inGroup = await sql<{ id: string }[]>`
      select id from members
      where group_id = ${groupId} and id in ${sql([p.toMemberId, ...debtorIds])}`;
    if (inGroup.length !== new Set([p.toMemberId, ...debtorIds]).size) {
      return reply.code(422).send({ error: "Someone in this payment isn't in the group" });
    }

    try {
      const payment = await sql.begin(async (tx) => {
        const [row] = await tx<{ id: string }[]>`
          insert into payments (group_id, from_member_id, to_member_id, mode, reference)
          values (${groupId}, ${who.memberId}, ${p.toMemberId}, ${p.mode}, ${p.reference})
          returning id`;
        for (const a of p.allocations) {
          await tx`
            insert into payment_allocations (payment_id, debtor_member_id, amount_centavos)
            values (${row!.id}, ${a.debtorMemberId}, ${a.amountCentavos})`;
        }
        return row!;
      });
      return reply.code(201).send({ id: payment.id, status: "pending" });
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
      select id, from_member_id as "fromMemberId", to_member_id as "toMemberId", status
      from payments where id = ${paymentId} and group_id = ${groupId}`;
    if (!payment) return reply.code(404).send({ error: "Payment not found" });
    if (payment.toMemberId !== who.memberId) {
      return reply.code(403).send({ error: "Only the person who received the money can answer this" });
    }

    const [updated] = await sql<{ id: string }[]>`
      update payments set status = ${to}
      where id = ${paymentId} and status = 'pending'
      returning id`;
    if (!updated) {
      return reply.code(409).send({ error: "This payment isn't waiting for an answer right now" });
    }
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
      select id, from_member_id as "fromMemberId", to_member_id as "toMemberId", status
      from payments where id = ${paymentId} and group_id = ${groupId}`;
    if (!payment) return reply.code(404).send({ error: "Payment not found" });
    if (payment.fromMemberId !== who.memberId) {
      return reply.code(403).send({ error: "Only the person who sent the money can attach proof" });
    }

    const type = request.headers["content-type"];
    const bytes = request.body;
    if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
      return reply.code(400).send({ error: "Attach a PNG or JPEG screenshot" });
    }

    const [updated] = await sql<{ id: string }[]>`
      update payments set proof = ${bytes}, proof_type = ${type ?? null}, status = 'pending'
      where id = ${paymentId} and status = 'disputed'
      returning id`;
    if (!updated) {
      return reply.code(409).send({ error: "Proof is only needed after the receiver disputes this payment" });
    }
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
    if (!row) return reply.code(404).send({ error: "No screenshot attached" });

    return reply.header("content-type", row.proofType).header("cache-control", "private, no-store").send(row.proof);
  });
}
