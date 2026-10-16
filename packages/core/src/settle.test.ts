/**
 * settle.test.ts
 *
 * WHAT: Automated checks for settle.ts. Run them with `npm test`.
 */
import { describe, it, expect } from "vitest";
import { settleGreedy, settleViaCollector, type Transfer } from "./settle";
import type { Balances } from "./balances";

/** Pretend everyone made their payments, and return what balances are left. */
function applyTransfers(balances: Balances, transfers: Transfer[]): Balances {
  const left: Balances = { ...balances };
  for (const t of transfers) {
    left[t.fromId] = (left[t.fromId] ?? 0) + t.amount; // paying reduces what you owe
    left[t.toId] = (left[t.toId] ?? 0) - t.amount; // receiving reduces what you are owed
  }
  return left;
}

const allZero = (balances: Balances) => Object.values(balances).every((v) => v === 0);

/** Seeded "random" numbers: the same ones every run, so failures can be reproduced. */
function makeRand(seed: number) {
  let s = seed;
  return (n: number) => {
    s = (s * 48271) % 2147483647;
    return s % n;
  };
}

/** Random balances for `count` people that add up to exactly 0. */
function randomBalances(rand: (n: number) => number, count: number): Balances {
  const balances: Balances = {};
  let total = 0;
  for (let i = 0; i < count - 1; i++) {
    const amount = rand(200001) - 100000;
    balances[`p${i}`] = amount;
    total += amount;
  }
  balances[`p${count - 1}`] = -total;
  return balances;
}

describe("settleGreedy", () => {
  it("everyone who owes pays the person who is owed", () => {
    expect(settleGreedy({ ana: 20000, ben: -10000, carl: -10000 })).toEqual([
      { fromId: "ben", toId: "ana", amount: 10000 },
      { fromId: "carl", toId: "ana", amount: 10000 },
    ]);
  });

  it("skips the middleman: A owes B and B owes C becomes A pays C", () => {
    // A owes B 100, B owes C 100 -> B is even, so only one payment is needed
    expect(settleGreedy({ a: -10000, b: 0, c: 10000 })).toEqual([
      { fromId: "a", toId: "c", amount: 10000 },
    ]);
  });

  it("matches the biggest debtor with the biggest creditor (4 people, 3 payments)", () => {
    const balances = { a: 5000, b: 3000, c: -2000, d: -6000 };
    expect(settleGreedy(balances)).toEqual([
      { fromId: "d", toId: "a", amount: 5000 },
      { fromId: "c", toId: "b", amount: 2000 },
      { fromId: "d", toId: "b", amount: 1000 },
    ]);
  });

  it("returns nothing when everyone is settled", () => {
    expect(settleGreedy({ ana: 0, ben: 0 })).toEqual([]);
    expect(settleGreedy({})).toEqual([]);
  });

  it("gives the same answer no matter what order the people are listed in", () => {
    const one = settleGreedy({ a: 5000, b: 3000, c: -2000, d: -6000 });
    const two = settleGreedy({ d: -6000, c: -2000, b: 3000, a: 5000 });
    expect(two).toEqual(one);
  });

  it("does not change the balances you pass in", () => {
    const balances = { ana: 20000, ben: -20000 };
    settleGreedy(balances);
    expect(balances).toEqual({ ana: 20000, ben: -20000 });
  });

  it("rejects balances that do not add up to 0, or have decimals", () => {
    expect(() => settleGreedy({ ana: 10000, ben: -5000 })).toThrow("add up to 0");
    expect(() => settleGreedy({ ana: 100.5, ben: -100.5 })).toThrow();
  });

  it("settles everyone and uses at most n - 1 payments (500 random groups)", () => {
    const rand = makeRand(2024);
    for (let run = 0; run < 500; run++) {
      const people = rand(8) + 2; // 2 to 9 people
      const balances = randomBalances(rand, people);
      const transfers = settleGreedy(balances);

      expect(allZero(applyTransfers(balances, transfers))).toBe(true);
      expect(transfers.length).toBeLessThanOrEqual(people - 1);
      for (const t of transfers) {
        expect(t.amount).toBeGreaterThan(0);
        expect(Number.isSafeInteger(t.amount)).toBe(true);
        expect(t.fromId).not.toBe(t.toId);
      }
    }
  });
});

describe("settleViaCollector", () => {
  it("when the collector is owed money, everyone else pays them", () => {
    expect(settleViaCollector({ ana: 20000, ben: -10000, carl: -10000 }, "ana")).toEqual([
      { fromId: "ben", toId: "ana", amount: 10000 },
      { fromId: "carl", toId: "ana", amount: 10000 },
    ]);
  });

  it("when the collector owes money, they pay the people who are owed", () => {
    // ben collects: carl pays ben, then ben pays ana the full 20000
    expect(settleViaCollector({ ana: 20000, ben: -10000, carl: -10000 }, "ben")).toEqual([
      { fromId: "ben", toId: "ana", amount: 20000 },
      { fromId: "carl", toId: "ben", amount: 10000 },
    ]);
  });

  it("works when the collector is not in the group's bills at all", () => {
    expect(settleViaCollector({ x: 500, y: -500 }, "z")).toEqual([
      { fromId: "z", toId: "x", amount: 500 },
      { fromId: "y", toId: "z", amount: 500 },
    ]);
  });

  it("returns nothing when everyone is settled", () => {
    expect(settleViaCollector({ ana: 0, ben: 0 }, "ana")).toEqual([]);
  });

  it("rejects balances that do not add up to 0", () => {
    expect(() => settleViaCollector({ ana: 10000, ben: -5000 }, "ana")).toThrow("add up to 0");
  });

  it("settles everyone and uses at most n - 1 payments (500 random groups)", () => {
    const rand = makeRand(99);
    for (let run = 0; run < 500; run++) {
      const people = rand(8) + 2;
      const balances = randomBalances(rand, people);
      const collectorId = `p${rand(people)}`;
      const transfers = settleViaCollector(balances, collectorId);

      expect(allZero(applyTransfers(balances, transfers))).toBe(true);
      expect(transfers.length).toBeLessThanOrEqual(people - 1);
      for (const t of transfers) {
        expect(t.amount).toBeGreaterThan(0);
        expect(t.fromId === collectorId || t.toId === collectorId).toBe(true);
      }
    }
  });
});