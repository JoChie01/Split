/**
 * receipts.ts
 *
 * WHAT: Deletes receipt screenshots 3 days after their payment was confirmed.
 * WHY:  A receipt shows account names and numbers, which the app doesn't otherwise keep.
 * RULES: Only confirmed payments are cleared. Disputed receipts stay until the dispute is settled.
 *        The payment record itself (amount, reference, date) is kept under the history rule.
 */
import type { Sql } from "./db";

export const RECEIPT_DAYS = 3;

/** Deletes receipts of payments confirmed more than RECEIPT_DAYS ago. Returns how many were cleared. */
export async function purgeExpiredReceipts(sql: Sql): Promise<number> {
  const cleared = await sql<{ id: string }[]>`
    update payments set proof = null, proof_type = null
    where status = 'confirmed'
      and proof is not null
      and decided_at is not null
      and decided_at < now() - make_interval(days => ${RECEIPT_DAYS})
    returning id`;
  return cleared.length;
}
