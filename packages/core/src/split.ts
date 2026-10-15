/**
 * split.ts
 *
 * WHAT: Ways to divide a bill between people. Every function returns
 *       "who owes how many centavos", and the shares ALWAYS add up to the total.
 * RULE: Leftover centavos go to the person who paid, so nothing is lost or invented.
 */
import { assertCentavos, type Centavos } from "./money";

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