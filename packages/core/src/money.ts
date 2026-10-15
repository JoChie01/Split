/**
 * Money in Split is ALWAYS a whole number of centavos (₱19.99 -> 1999).
 * We never store or calculate with pesos as decimals, because floats
 * cannot represent most decimal fractions exactly.
 */
export type Centavos = number;

/** Throws unless n is a whole number we can safely do math on. Negatives are allowed (balances). */
export function assertInteger(n: number): void {
  if (!Number.isSafeInteger(n)) {
    throw new Error(`Expected a whole number of centavos, got ${n}`);
  }
}

/** Same as assertInteger, but also rejects negatives. Use for amounts people enter. */
export function assertCentavos(n: number): void {
  assertInteger(n);
  if (n < 0) throw new Error(`Amount cannot be negative, got ${n}`);
}

/**
 * Turns what a person types ("1,250.50", "₱500", "19.9") into centavos.
 * Returns null if it is not a valid peso amount. Works on the TEXT, so no float is ever involved.
 */
export function parsePeso(input: string): Centavos | null {
  const cleaned = input.replace(/[₱,\s]/g, "");
  // 1 to 9 digits, then optionally "." and 1 or 2 digits
  const match = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) return null;
  const pesos = Number(match[1]);
  const centavos = Number((match[2] ?? "").padEnd(2, "0"));
  return pesos * 100 + centavos;
}

/** Turns centavos into display text: 125050 -> "₱1,250.50". */
export function formatPeso(centavos: Centavos): string {
  assertInteger(centavos);
  const sign = centavos < 0 ? "-" : "";
  const abs = Math.abs(centavos);
  const pesos = Math.trunc(abs / 100);
  const cents = String(abs % 100).padStart(2, "0");
  return `${sign}₱${pesos.toLocaleString("en-US")}.${cents}`;
}