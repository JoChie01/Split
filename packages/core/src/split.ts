/**
 * split.ts
 *
 * WHAT: Ways to divide a bill between people. Every function returns
 *       "who owes how many centavos", and the shares ALWAYS add up to the total.
 * RULE: Leftover centavos go to the person who paid, so nothing is lost or invented.
 */
import { assertCentavos, formatPeso, type Centavos } from "./money";

/** Maps a person's id to the centavos they owe. Example: { ana: 3334, ben: 3333 } */
export type Shares = Record<string, Centavos>;

/**
 * Split a bill equally.
 * Example: ₱100.00 (10000) between 3 people, ana paid:
 *   everyone gets 3333, 1 centavo is left over -> ana gets 3334.
 */
export function splitEqual(
  total: Centavos,
  participantIds: string[],
  payerId: string,
): Shares {
  assertCentavos(total);
  if (participantIds.length === 0) {
    throw new Error("Pick at least one person to split between");
  }
  if (new Set(participantIds).size !== participantIds.length) {
    throw new Error("Each person can only be listed once");
  }

  const base = Math.floor(total / participantIds.length); // everyone's even share
  const leftover = total - base * participantIds.length; // 0 up to (people - 1) centavos

  const shares: Shares = {};
  for (const id of participantIds) shares[id] = base;

  // The payer absorbs the leftover. If they were not part of the split,
  // they appear only when there is a leftover to absorb.
  if (leftover > 0) shares[payerId] = (shares[payerId] ?? 0) + leftover;

  return shares;
}

/**
 * Split a bill by exact amounts each person agreed to pay.
 * The amounts must add up to the total, otherwise we refuse (nothing is guessed).
 * Example: ₱100.00 -> { ana: 7000, ben: 3000 }
 */
export function splitByAmounts(total: Centavos, amounts: Shares): Shares {
  assertCentavos(total);
  const ids = Object.keys(amounts);
  if (ids.length === 0) throw new Error("Pick at least one person to split between");

  let sum = 0;
  for (const id of ids) {
    const amount = amounts[id] as Centavos; // we know it exists, we are looping over its keys
    assertCentavos(amount);
    sum += amount;
  }

  if (sum !== total) {
    const gap = total - sum;
    const how = gap > 0 ? `${formatPeso(gap)} short of` : `${formatPeso(-gap)} over`;
    throw new Error(`Amounts add up to ${formatPeso(sum)}, which is ${how} ${formatPeso(total)}`);
  }
  return { ...amounts };
}

/**
 * Split a bill by percentage. Percentages are in BASIS POINTS: 100% = 10000, 33.33% = 3333.
 * (Whole numbers again, so there are no decimal surprises.)
 * Each share is rounded DOWN, and the leftover centavos go to the payer.
 * Example: ₱100.00, 50% / 30% / 20% -> { ana: 5000, ben: 3000, carl: 2000 }
 */
export function splitByPercent(
  total: Centavos,
  basisPoints: Shares,
  payerId: string,
): Shares {
  assertCentavos(total);
  const ids = Object.keys(basisPoints);
  if (ids.length === 0) throw new Error("Pick at least one person to split between");

  let sum = 0;
  for (const id of ids) {
    const bp = basisPoints[id] as number;
    assertCentavos(bp); // whole, not negative
    sum += bp;
  }
  if (sum !== 10000) {
    throw new Error(`Percentages add up to ${sum / 100}%, they need to add up to 100%`);
  }

  // BigInt is a number type with no size limit, so total * bp can never overflow or round.
  const shares: Shares = {};
  let given = 0;
  for (const id of ids) {
    const bp = basisPoints[id] as number;
    const share = Number((BigInt(total) * BigInt(bp)) / 10000n); // BigInt division rounds down
    shares[id] = share;
    given += share;
  }

  const leftover = total - given;
  if (leftover > 0) shares[payerId] = (shares[payerId] ?? 0) + leftover;
  return shares;
}

/** One line on the receipt: what it cost, and who shared it. */
export type Item = { price: Centavos; sharedBy: string[] };

/** The result of splitting a receipt: the full total, and what each person owes. */
export type ItemSplit = { total: Centavos; shares: Shares };

/** Adds every person's amount in `extra` onto `target` (creating them if needed). */
function addInto(target: Shares, extra: Shares): void {
  for (const [id, amount] of Object.entries(extra)) {
    target[id] = (target[id] ?? 0) + amount;
  }
}

/**
 * Shares `amount` out in proportion to `weights` (bigger weight = bigger share).
 * Each share is rounded down, and the leftover centavos go to the payer.
 */
function shareProportionally(amount: Centavos, weights: Shares, payerId: string): Shares {
  const ids = Object.keys(weights);
  let totalWeight = 0n; // BigInt again, so big bills can never overflow
  for (const id of ids) totalWeight += BigInt(weights[id] as number);
  if (totalWeight === 0n) {
    throw new Error("Cannot share the extra charge because every item is free");
  }

  const out: Shares = {};
  let given = 0;
  for (const id of ids) {
    const share = Number((BigInt(amount) * BigInt(weights[id] as number)) / totalWeight);
    out[id] = share;
    given += share;
  }

  const leftover = amount - given;
  if (leftover > 0) out[payerId] = (out[payerId] ?? 0) + leftover;
  return out;
}

/**
 * Split a receipt item by item, then share tax / service charge ("extras")
 * in proportion to what each person ordered.
 *
 * Step 1: each item is split equally between the people who shared it.
 * Step 2: the extras are split in proportion to each person's item total.
 * Leftover centavos go to the payer both times.
 *
 * Example: pasta 200 (ana), steak 350 (ben), drinks 150 (both), no extras
 *   -> ana owes 275, ben owes 425.
 */
export function splitByItems(items: Item[], extras: Centavos, payerId: string): ItemSplit {
  assertCentavos(extras);
  if (items.length === 0) throw new Error("Add at least one item");

  const shares: Shares = {};
  let total = 0;

  for (const item of items) {
    assertCentavos(item.price);
    if (item.sharedBy.length === 0) throw new Error("Every item needs at least one person");
    addInto(shares, splitEqual(item.price, item.sharedBy, payerId));
    total += item.price;
  }

  if (extras > 0) {
    addInto(shares, shareProportionally(extras, shares, payerId));
    total += extras;
  }

  return { total, shares };
}