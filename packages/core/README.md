# core

The brain of Split. Pure TypeScript functions with no database and no UI. All amounts are integer centavos.

- `money.ts`: parse and format peso amounts
- `split.ts`: `splitEqual`, `splitByAmounts`, `splitByPercent` and `splitByItems` turn a bill into each person's share
- `balances.ts`: `computeBalances` works out who owes what from expenses and payments
- `settle.ts`: `settleGreedy` and `settleViaCollector` turn balances into the transfers needed to settle up

Run the tests: `npm test -w @split/core`
