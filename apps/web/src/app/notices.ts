/**
 * notices.ts
 *
 * WHAT: Works out which payments need this person's action, and which are just history.
 * WHY:  The Payments badge and the "Needs your action" list both come from here, so they always agree.
 *
 * RULES (match apps/api/src/routes/payments.ts):
 *   - The receiver can confirm once a receipt is attached (pending + hasProof).
 *   - The sender attaches a receipt while pending with none, or again after a dispute.
 *   - Everything else is history.
 */
import type { Payment } from "./types";

export type Notice = { payment: Payment; kind: "confirm" | "receipt" };

export function splitNotices(payments: Payment[], meId: string): { needs: Notice[]; earlier: Payment[] } {
  const needs: Notice[] = [];
  const earlier: Payment[] = [];

  for (const payment of payments) {
    const isReceiver = payment.toMemberId === meId;
    const isSender = payment.fromMemberId === meId;

    if (isReceiver && payment.status === "pending" && payment.hasProof) {
      needs.push({ payment, kind: "confirm" });
    } else if (isSender && ((payment.status === "pending" && !payment.hasProof) || payment.status === "disputed")) {
      needs.push({ payment, kind: "receipt" });
    } else if (isReceiver || isSender) {
      earlier.push(payment);
    }
  }

  return { needs, earlier };
}
