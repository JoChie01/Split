/**
 * balances.ts
 *
 * WHAT: Works out who is owed money and who owes money, from all the bills
 *       and payments in a group.
 * RULE: balance = (what you paid out) - (what you owe), in centavos.
 *       Positive = the group owes YOU. Negative = YOU owe the group.
 *       All balances in a group always add up to exactly 0.
 */
import { assertCentavos, type Centavos } from "./money";
import type { Shares } from "./split";

/** One bill: who paid it, the full total, and what each person's share is. */
export type Expense = { payerId: string; total: Centavos; shares: Shares };

/** Part of a payment that clears one person's debt. */
export type Allocation = { debtorId: string; amount: Centavos };

/**
 * When you pay for someone else:
 *  - "reimburse": their debt to the receiver is cleared, but they now owe YOU.
 *  - "treat": their debt is cleared and nobody owes you for it (a gift).
 */
export type PaymentMode = "reimburse" | "treat";

export type PaymentStatus = "pending" | "confirmed" | "rejected";

/**
 * Money sent from one person to another. One payment can cover several people's
 * debts (yours plus friends you are paying for). The amount sent is the sum of
 * the allocations, so there is only one place the number can come from.
 */
export type Payment = {
  fromId: string;
  toId: string;
  allocations: Allocation[];
  mode: PaymentMode;
  status: PaymentStatus;
};

/** Maps a person's id to their balance. Example: { ana: 20000, ben: -10000, carl: -10000 } */
export type Balances = Record<string, Centavos>;

function add(balances: Balances, id: string, amount: Centavos): void {
  balances[id] = (balances[id] ?? 0) + amount;
}

/**
 * Compute everyone's balance from bills and payments.
 *
 * - Pending payments COUNT (the money is on its way, so nobody can pay the same debt twice).
 * - Rejected payments are ignored (they never happened).
 */
export function computeBalances(expenses: Expense[], payments: Payment[]): Balances {
  const balances: Balances = {};

  for (const expense of expenses) {
    assertCentavos(expense.total);
    let sharesTotal = 0;
    for (const [id, amount] of Object.entries(expense.shares)) {
      assertCentavos(amount);
      sharesTotal += amount;
      add(balances, id, -amount); // everyone owes their share
    }
    if (sharesTotal !== expense.total) {
      throw new Error("An expense's shares must add up to its total");
    }
    add(balances, expense.payerId, expense.total); // the payer paid the whole bill
  }

  for (const payment of payments) {
    if (payment.status === "rejected") continue;
    for (const { debtorId, amount } of payment.allocations) {
      assertCentavos(amount);
      add(balances, payment.toId, -amount); // the receiver is owed less now
      if (payment.mode === "reimburse" && debtorId !== payment.fromId) {
        add(balances, payment.fromId, amount); // the sender is now owed by the debtor
      } else {
        add(balances, debtorId, amount); // the debtor's own debt shrinks
      }
    }
  }

  const total = Object.values(balances).reduce((a, b) => a + b, 0);
  if (total !== 0) throw new Error(`Balances must add up to 0, got ${total}`);
  return balances;
}