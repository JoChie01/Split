/**
 * balances.test.ts
 *
 * WHAT: Automated checks for balances.ts. Run them with `npm test`.
 */
import { describe, it, expect } from "vitest";
import { computeBalances, type Expense, type Payment } from "./balances";
import { splitEqual } from "./split";

const sum = (balances: Record<string, number>) =>
  Object.values(balances).reduce((a, b) => a + b, 0);

/** A ₱300 dinner paid by ana, split equally between ana, ben and carl. */
const dinner: Expense = {
  payerId: "ana",
  total: 30000,
  shares: splitEqual(30000, ["ana", "ben", "carl"], "ana"),
};

describe("computeBalances: bills only", () => {
  it("one bill: the payer is owed, everyone else owes", () => {
    expect(computeBalances([dinner], [])).toEqual({ ana: 20000, ben: -10000, carl: -10000 });
  });

  it("several bills net out (ana paid 300, ben paid 150, split 3 ways)", () => {
    const taxi: Expense = {
      payerId: "ben",
      total: 15000,
      shares: splitEqual(15000, ["ana", "ben", "carl"], "ben"),
    };
    expect(computeBalances([dinner, taxi], [])).toEqual({ ana: 15000, ben: 0, carl: -15000 });
  });

  it("no bills and no payments gives no balances", () => {
    expect(computeBalances([], [])).toEqual({});
  });
});

describe("computeBalances: payments", () => {
  const benPaysAna = (status: Payment["status"]): Payment => ({
    fromId: "ben",
    toId: "ana",
    allocations: [{ debtorId: "ben", amount: 10000 }],
    mode: "reimburse",
    status,
  });

  it("a confirmed payment clears the debt", () => {
    expect(computeBalances([dinner], [benPaysAna("confirmed")])).toEqual({
      ana: 10000,
      ben: 0,
      carl: -10000,
    });
  });

  it("a pending payment counts too, so nobody pays the same debt twice", () => {
    expect(computeBalances([dinner], [benPaysAna("pending")])).toEqual({
      ana: 10000,
      ben: 0,
      carl: -10000,
    });
  });

  it("a rejected payment is ignored: the debt is back", () => {
    expect(computeBalances([dinner], [benPaysAna("rejected")])).toEqual({
      ana: 20000,
      ben: -10000,
      carl: -10000,
    });
  });

  it("ben pays for himself and carl as a treat: everything is settled", () => {
    const payment: Payment = {
      fromId: "ben",
      toId: "ana",
      allocations: [
        { debtorId: "ben", amount: 10000 },
        { debtorId: "carl", amount: 10000 },
      ],
      mode: "treat",
      status: "confirmed",
    };
    expect(computeBalances([dinner], [payment])).toEqual({ ana: 0, ben: 0, carl: 0 });
  });

  it("ben pays for carl as a reimbursement: carl now owes ben instead of ana", () => {
    const payment: Payment = {
      fromId: "ben",
      toId: "ana",
      allocations: [
        { debtorId: "ben", amount: 10000 },
        { debtorId: "carl", amount: 10000 },
      ],
      mode: "reimburse",
      status: "confirmed",
    };
    expect(computeBalances([dinner], [payment])).toEqual({ ana: 0, ben: 10000, carl: -10000 });
  });
});

describe("computeBalances: safety", () => {
  it("always adds up to exactly 0 (300 random groups, same ones every run)", () => {
    let seed = 777;
    const rand = (n: number) => {
      seed = (seed * 48271) % 2147483647;
      return seed % n;
    };
    const people = ["a", "b", "c", "d", "e"];

    for (let run = 0; run < 300; run++) {
      const expenses: Expense[] = [];
      for (let i = 0; i < rand(6) + 1; i++) {
        const payerId = people[rand(5)] as string;
        const total = rand(500000);
        const sharedBy = people.filter((_, j) => ((rand(31) + 1) >> j) & 1);
        const participants = sharedBy.length > 0 ? sharedBy : [payerId];
        expenses.push({ payerId, total, shares: splitEqual(total, participants, payerId) });
      }
      const payments: Payment[] = [];
      for (let i = 0; i < rand(4); i++) {
        payments.push({
          fromId: people[rand(5)] as string,
          toId: people[rand(5)] as string,
          allocations: [{ debtorId: people[rand(5)] as string, amount: rand(100000) }],
          mode: rand(2) === 0 ? "reimburse" : "treat",
          status: (["pending", "confirmed", "rejected"] as const)[rand(3)] as Payment["status"],
        });
      }
      expect(sum(computeBalances(expenses, payments))).toBe(0);
    }
  });

  it("rejects an expense whose shares do not add up to its total", () => {
    const broken: Expense = { payerId: "ana", total: 10000, shares: { ana: 5000, ben: 4000 } };
    expect(() => computeBalances([broken], [])).toThrow("shares must add up");
  });

  it("rejects decimal or negative payment amounts", () => {
    const base = { fromId: "ben", toId: "ana", mode: "reimburse", status: "confirmed" } as const;
    expect(() =>
      computeBalances([dinner], [{ ...base, allocations: [{ debtorId: "ben", amount: 50.5 }] }]),
    ).toThrow();
    expect(() =>
      computeBalances([dinner], [{ ...base, allocations: [{ debtorId: "ben", amount: -100 }] }]),
    ).toThrow();
  });
});