/**
 * settle.ts
 *
 * WHAT: Turns everyone's balances into a short list of "who pays whom".
 * IDEA: Instead of paying back every bill one by one, we only move the money
 *       that is actually needed. For n people this takes at most n - 1 payments.
 * INPUT: balances from balances.ts. Positive = is owed money, negative = owes money,
 *        and they must add up to exactly 0.
 */
import { assertInteger, type Centavos } from "./money";
import type { Balances } from "./balances";

/** One payment to make: `fromId` sends `amount` centavos to `toId`. */
export type Transfer = { fromId: string; toId: string; amount: Centavos };

function assertBalancesValid(balances: Balances): void {
  let total = 0;
  for (const amount of Object.values(balances)) {
    assertInteger(amount);
    total += amount;
  }
  if (total !== 0) throw new Error(`Balances must add up to 0, got ${total}`);
}

type Entry = { id: string; amount: Centavos };

/**
 * Fewest-payments settle-up ("greedy"): repeatedly match the person who owes
 * the MOST with the person who is owed the MOST.
 * Each payment settles at least one person completely, so for n people there are
 * at most n - 1 payments. (This is not always the absolute minimum, but it is
 * simple, fast and usually very close.)
 * Ties are broken by id, so the same balances always give the same answer.
 */
export function settleGreedy(balances: Balances): Transfer[] {
  assertBalancesValid(balances);

  const creditors: Entry[] = []; // people who are owed money
  const debtors: Entry[] = []; // people who owe money (stored as positive amounts)
  for (const id of Object.keys(balances).sort()) {
    const amount = balances[id] as Centavos;
    if (amount > 0) creditors.push({ id, amount });
    else if (amount < 0) debtors.push({ id, amount: -amount });
  }

  const biggestFirst = (a: Entry, b: Entry) => b.amount - a.amount || (a.id < b.id ? -1 : 1);
  const transfers: Transfer[] = [];

  while (creditors.length > 0 && debtors.length > 0) {
    creditors.sort(biggestFirst);
    debtors.sort(biggestFirst);
    const creditor = creditors[0];
    const debtor = debtors[0];
    if (!creditor || !debtor) break;

    const amount = Math.min(creditor.amount, debtor.amount);
    transfers.push({ fromId: debtor.id, toId: creditor.id, amount });
    creditor.amount -= amount;
    debtor.amount -= amount;
    if (creditor.amount === 0) creditors.shift();
    if (debtor.amount === 0) debtors.shift();
  }

  return transfers;
}

/**
 * "Everyone pays one collector": everyone who owes pays the collector, and the
 * collector pays everyone who is owed. One payment per person, so at most n - 1.
 * The collector does not have to be part of the bills.
 */
export function settleViaCollector(balances: Balances, collectorId: string): Transfer[] {
  assertBalancesValid(balances);

  const transfers: Transfer[] = [];
  for (const id of Object.keys(balances).sort()) {
    if (id === collectorId) continue;
    const amount = balances[id] as Centavos;
    if (amount < 0) transfers.push({ fromId: id, toId: collectorId, amount: -amount });
    else if (amount > 0) transfers.push({ fromId: collectorId, toId: id, amount });
  }
  return transfers;
}