/**
 * split.test.ts
 *
 * WHAT: Automated checks for split.ts. Run them with `npm test`.
 */
import { describe, it, expect } from "vitest";
import { splitEqual, type Shares } from "./split";

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