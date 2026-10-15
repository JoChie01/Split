import { describe, it, expect } from "vitest";
import { parsePeso, formatPeso, assertCentavos } from "./money";

describe("why we never use floats", () => {
  it("multiplying a decimal peso amount by 100 gives the wrong centavos", () => {
    expect(19.99 * 100).not.toBe(1999); // it is 1998.9999999999998
    expect(parsePeso("19.99")).toBe(1999); // our parser gets it right
  });
});

describe("parsePeso", () => {
  it.each([
    ["100", 10000],
    ["19.99", 1999],
    ["19.9", 1990],
    ["0.01", 1],
    ["1,250.50", 125050],
    ["₱500", 50000],
    ["  12 ", 1200],
    ["0", 0],
    ["999999999.99", 99999999999],
  ])("reads %s as %i centavos", (input, expected) => {
    expect(parsePeso(input)).toBe(expected);
  });

  it.each(["", "abc", "1.234", "-5", "1e3", "12.", ".5", "1.2.3", "1000000000"])(
    "rejects %j",
    (input) => {
      expect(parsePeso(input)).toBeNull();
    },
  );
});

describe("formatPeso", () => {
  it.each([
    [0, "₱0.00"],
    [5, "₱0.05"],
    [1999, "₱19.99"],
    [125050, "₱1,250.50"],
    [-1999, "-₱19.99"],
  ])("formats %i as %s", (centavos, expected) => {
    expect(formatPeso(centavos)).toBe(expected);
  });

  it("refuses fractional centavos", () => {
    expect(() => formatPeso(12.5)).toThrow();
  });

  it("round-trips with parsePeso", () => {
    for (const c of [0, 1, 99, 100, 101, 123456, 99999999999]) {
      expect(parsePeso(formatPeso(c))).toBe(c);
    }
  });
});

describe("assertCentavos", () => {
  it("accepts whole non-negative numbers", () => {
    expect(() => assertCentavos(0)).not.toThrow();
    expect(() => assertCentavos(1999)).not.toThrow();
  });
  it("rejects decimals, negatives and NaN", () => {
    expect(() => assertCentavos(1.5)).toThrow();
    expect(() => assertCentavos(-1)).toThrow();
    expect(() => assertCentavos(NaN)).toThrow();
  });
});