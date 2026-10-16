/**
 * index.test.ts
 *
 * WHAT: One end-to-end check that all the pieces work together, using only
 *       what index.ts exports: split -> balances -> settle -> pay -> all zero.
 */
import { describe, it, expect } from "vitest";
import {
  parsePeso,
  splitEqual,
  computeBalances,
  settleGreedy,
  type Expense,
  type Payment,
} from "./index";

describe("the whole flow", () => {
  it("bills -> balances -> settle-up -> payment -> everyone is even", () => {
    const people = ["ana", "ben", "carl"];

    // Ana pays a ₱300 dinner, Ben pays a ₱150 taxi. Both are split 3 ways.
    const dinnerTotal = parsePeso("₱300") as number;
    const taxiTotal = parsePeso("150.00") as number;
    const expenses: Expense[] = [
      { payerId: "ana", total: dinnerTotal, shares: splitEqual(dinnerTotal, people, "ana") },
      { payerId: "ben", total: taxiTotal, shares: splitEqual(taxiTotal, people, "ben") },
    ];

    const balances = computeBalances(expenses, []);
    expect(balances).toEqual({ ana: 15000, ben: 0, carl: -15000 });

    // Three people, but only ONE payment is needed.
    const transfers = settleGreedy(balances);
    expect(transfers).toEqual([{ fromId: "carl", toId: "ana", amount: 15000 }]);

    // Carl makes that payment and Ana confirms it.
    const payments: Payment[] = transfers.map((t) => ({
      fromId: t.fromId,
      toId: t.toId,
      allocations: [{ debtorId: t.fromId, amount: t.amount }],
      mode: "reimburse",
      status: "confirmed",
    }));

    expect(computeBalances(expenses, payments)).toEqual({ ana: 0, ben: 0, carl: 0 });
  });
});