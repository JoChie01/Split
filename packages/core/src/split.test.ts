/**
 * split.test.ts
 *
 * WHAT: Automated checks for split.ts. Run them with `npm test`.
 */
import { describe, it, expect } from "vitest";
import {
  splitEqual,
  splitByAmounts,
  splitByPercent,
  splitByItems,
  type Item,
  type Shares,
} from "./split";

const sum = (shares: Shares) => Object.values(shares).reduce((a, b) => a + b, 0);

describe("splitEqual", () => {
  it("gives the leftover centavo to the payer (₱100 between 3)", () => {
    expect(splitEqual(10000, ["ana", "ben", "carl"], "ana")).toEqual({
      ana: 3334,
      ben: 3333,
      carl: 3333,
    });
  });

  it("gives the leftover to whoever paid, not always the first person", () => {
    expect(splitEqual(10000, ["ana", "ben", "carl"], "carl")).toEqual({
      ana: 3333,
      ben: 3333,
      carl: 3334,
    });
  });

  it("splits evenly when there is no leftover", () => {
    expect(splitEqual(9000, ["ana", "ben", "carl"], "ben")).toEqual({
      ana: 3000,
      ben: 3000,
      carl: 3000,
    });
  });

  it("handles 1 centavo between 5 people (payer gets it)", () => {
    expect(splitEqual(1, ["a", "b", "c", "d", "e"], "c")).toEqual({
      a: 0,
      b: 0,
      c: 1,
      d: 0,
      e: 0,
    });
  });

  it("works for a single person", () => {
    expect(splitEqual(12345, ["ana"], "ana")).toEqual({ ana: 12345 });
  });

  it("works for a total of zero", () => {
    expect(splitEqual(0, ["ana", "ben"], "ana")).toEqual({ ana: 0, ben: 0 });
  });

  it("charges a payer who is not in the split only for the leftover", () => {
    expect(splitEqual(10001, ["ben", "carl"], "ana")).toEqual({
      ben: 5000,
      carl: 5000,
      ana: 1,
    });
    // no leftover -> the payer does not appear at all
    expect(splitEqual(10000, ["ben", "carl"], "ana")).toEqual({
      ben: 5000,
      carl: 5000,
    });
  });

  it("always adds up exactly to the total (every total 0-500, 1-7 people)", () => {
    for (let total = 0; total <= 500; total++) {
      for (let n = 1; n <= 7; n++) {
        const ids = Array.from({ length: n }, (_, i) => `p${i}`);
        const shares = splitEqual(total, ids, "p0");
        expect(sum(shares)).toBe(total);
      }
    }
  });

  it("rejects bad input", () => {
    expect(() => splitEqual(1000, [], "ana")).toThrow();
    expect(() => splitEqual(1000, ["ana", "ana"], "ana")).toThrow();
    expect(() => splitEqual(10.5, ["ana"], "ana")).toThrow();
    expect(() => splitEqual(-100, ["ana"], "ana")).toThrow();
  });
});

describe("splitByAmounts", () => {
  it("accepts amounts that add up to the total", () => {
    expect(splitByAmounts(10000, { ana: 7000, ben: 3000 })).toEqual({ ana: 7000, ben: 3000 });
  });

  it("does not change the object you pass in", () => {
    const input = { ana: 7000, ben: 3000 };
    const result = splitByAmounts(10000, input);
    expect(result).not.toBe(input);
  });

  it("explains a shortfall in pesos", () => {
    expect(() => splitByAmounts(10000, { ana: 5000, ben: 4000 })).toThrow(
      "Amounts add up to ₱90.00, which is ₱10.00 short of ₱100.00",
    );
  });

  it("explains an overage in pesos", () => {
    expect(() => splitByAmounts(10000, { ana: 7000, ben: 4000 })).toThrow(
      "Amounts add up to ₱110.00, which is ₱10.00 over ₱100.00",
    );
  });

  it("rejects bad input", () => {
    expect(() => splitByAmounts(10000, {})).toThrow();
    expect(() => splitByAmounts(10000, { ana: 10000.5 })).toThrow();
    expect(() => splitByAmounts(10000, { ana: 11000, ben: -1000 })).toThrow();
  });
});

describe("splitByPercent (basis points: 100% = 10000)", () => {
  it("splits 50 / 30 / 20", () => {
    expect(splitByPercent(10000, { ana: 5000, ben: 3000, carl: 2000 }, "ana")).toEqual({
      ana: 5000,
      ben: 3000,
      carl: 2000,
    });
  });

  it("handles 33.33 / 33.33 / 33.34", () => {
    expect(splitByPercent(10000, { ana: 3333, ben: 3333, carl: 3334 }, "ana")).toEqual({
      ana: 3333,
      ben: 3333,
      carl: 3334,
    });
  });

  it("gives rounding leftovers to the payer (₱10.01 at 50 / 50)", () => {
    expect(splitByPercent(1001, { ana: 5000, ben: 5000 }, "ana")).toEqual({
      ana: 501,
      ben: 500,
    });
    expect(splitByPercent(1001, { ana: 5000, ben: 5000 }, "ben")).toEqual({
      ana: 500,
      ben: 501,
    });
  });

  it("gives the leftover to the payer even when the shares are tiny (10 centavos)", () => {
    // each share rounds down to 3, leaving 1 centavo for the payer
    expect(splitByPercent(10, { ana: 3333, ben: 3333, carl: 3334 }, "carl")).toEqual({
      ana: 3,
      ben: 3,
      carl: 4,
    });
  });

  it("is exact even for huge amounts (no float rounding)", () => {
    const total = 99999999999; // ₱999,999,999.99
    const shares = splitByPercent(total, { a: 3333, b: 3333, c: 3334 }, "a");
    expect(sum(shares)).toBe(total);
  });

  it("always adds up exactly to the total", () => {
    const plans: Shares[] = [
      { a: 3333, b: 3333, c: 3334 },
      { a: 10000 },
      { a: 1, b: 9999 },
      { a: 2500, b: 2500, c: 2500, d: 2500 },
      { a: 3333, b: 6667 },
    ];
    for (let total = 0; total <= 300; total++) {
      for (const plan of plans) {
        expect(sum(splitByPercent(total, plan, "a"))).toBe(total);
      }
    }
  });

  it("rejects percentages that do not add up to 100%", () => {
    expect(() => splitByPercent(10000, { ana: 3333, ben: 3333, carl: 3333 }, "ana")).toThrow(
      "Percentages add up to 99.99%",
    );
  });

  it("rejects bad input", () => {
    expect(() => splitByPercent(10000, {}, "ana")).toThrow();
    expect(() => splitByPercent(10000, { ana: 5000.5, ben: 4999.5 }, "ana")).toThrow();
    expect(() => splitByPercent(10000, { ana: 11000, ben: -1000 }, "ana")).toThrow();
    expect(() => splitByPercent(-100, { ana: 10000 }, "ana")).toThrow();
  });
});

describe("splitByItems", () => {
  it("splits a receipt where some items are shared (pasta, steak, drinks)", () => {
    const items: Item[] = [
      { price: 20000, sharedBy: ["ana"] },
      { price: 35000, sharedBy: ["ben"] },
      { price: 15000, sharedBy: ["ana", "ben"] },
    ];
    expect(splitByItems(items, 0, "ana")).toEqual({
      total: 70000,
      shares: { ana: 27500, ben: 42500 },
    });
  });

  it("gives leftover centavos inside a shared item to the payer", () => {
    const result = splitByItems([{ price: 10000, sharedBy: ["a", "b", "c"] }], 0, "a");
    expect(result.shares).toEqual({ a: 3334, b: 3333, c: 3333 });
  });

  it("shares tax and service charge in proportion to what each person ordered", () => {
    const items: Item[] = [
      { price: 10000, sharedBy: ["a"] },
      { price: 30000, sharedBy: ["b"] },
    ];
    // 4000 extra is 10% of the 40000 items: a pays 1000 of it, b pays 3000
    expect(splitByItems(items, 4000, "a")).toEqual({
      total: 44000,
      shares: { a: 11000, b: 33000 },
    });
  });

  it("gives leftover centavos from the extra charge to the payer", () => {
    const items: Item[] = [
      { price: 10000, sharedBy: ["a"] },
      { price: 10000, sharedBy: ["b"] },
      { price: 10000, sharedBy: ["c"] },
    ];
    // ₱1.00 extra over 3 people: 33 each, 1 centavo left for the payer (b)
    expect(splitByItems(items, 100, "b")).toEqual({
      total: 30100,
      shares: { a: 10033, b: 10034, c: 10033 },
    });
  });

  it("lists the payer only when they owe something", () => {
    const result = splitByItems([{ price: 10001, sharedBy: ["b", "c"] }], 0, "a");
    expect(result.shares).toEqual({ b: 5000, c: 5000, a: 1 });
  });

  it("always adds up exactly (500 random receipts, same ones every run)", () => {
    // Park-Miller generator: "random" numbers that repeat each run, so a failure is reproducible.
    let seed = 12345;
    const rand = (n: number) => {
      seed = (seed * 48271) % 2147483647;
      return seed % n;
    };
    const people = ["a", "b", "c", "d"];

    for (let run = 0; run < 500; run++) {
      const items: Item[] = [];
      let expected = 0;
      const count = rand(5) + 1;
      for (let i = 0; i < count; i++) {
        const price = rand(100000) + 1;
        const mask = rand(15) + 1; // which of the 4 people shared it (never nobody)
        items.push({ price, sharedBy: people.filter((_, j) => (mask >> j) & 1) });
        expected += price;
      }
      const extras = rand(10000);
      expected += extras;

      const result = splitByItems(items, extras, people[rand(4)] as string);
      expect(result.total).toBe(expected);
      expect(sum(result.shares)).toBe(result.total);
    }
  });

  it("rejects bad input", () => {
    expect(() => splitByItems([], 0, "a")).toThrow();
    expect(() => splitByItems([{ price: 100, sharedBy: [] }], 0, "a")).toThrow();
    expect(() => splitByItems([{ price: 100, sharedBy: ["a", "a"] }], 0, "a")).toThrow();
    expect(() => splitByItems([{ price: 100.5, sharedBy: ["a"] }], 0, "a")).toThrow();
    expect(() => splitByItems([{ price: 100, sharedBy: ["a"] }], -1, "a")).toThrow();
    expect(() => splitByItems([{ price: 100, sharedBy: ["a"] }], 10.5, "a")).toThrow();
    // extra charge, but nothing to share it by
    expect(() => splitByItems([{ price: 0, sharedBy: ["a"] }], 500, "a")).toThrow();
  });
});