# Split

Shared expenses with proof of payment, built for Philippine pesos.

Log a bill, split it equally, by amount, by percentage or by item, then collect payments with receipt proof and a confirm or dispute step. All money is stored as integer centavos, never floats.

Split only keeps records. It does not move money: people pay each other through GCash, a bank or another e-wallet, then attach a receipt in the app.

> Work in progress. Not live yet.

## Status

- [x] 1. Split and settle-up functions with unit tests
- [x] 2. Backend and database
- [ ] 3. UI for groups, expenses and balances (log-in, sign-up and the payments list are done; the rest is in progress)
- [ ] 4. Payment proof and confirm/dispute flow (the backend and the payments list are done; the screen to record a payment is still to do)
- [ ] 5. Deploy, and README with screenshots

## What works today

- **Accounts:** sign-up with a privacy notice, and log-in by an emailed single-use link (no passwords). The log-in page can offer the last email used on that device.
- **Groups:** one owner per group, join links with a seat limit, members.
- **Bills:** equal, by-amount, by-percentage and by-item splits.
- **Payments:** the app works out what each person owes. The payer enters a reference number and attaches a PNG or JPEG receipt (up to 2 MB). The receiver confirms or disputes, and the payer can attach a new receipt after a dispute.
- **Web app:** landing page, sign-up, log-in, a groups list, and a group page with a Payments tab that shows what needs your action.

## Still to do

- Web screens: create a group, show the invite link, add bills, record a payment, join a group.
- Show the account name when someone joins a group.
- Automatic deletion of old payment records.
- Send email from a verified domain.
- Hosting, backups and an owner audit view.

## Privacy

Split stores names, emails and payment receipts. The retention rules are still being finalized, and the cleanup job is not built yet.

## Run it locally

You need Node 24 and a PostgreSQL database.

```
npm ci
cp apps/api/.env.example apps/api/.env   # then fill in the values
npm run migrate -w @split/api
npm run dev -w @split/api                # API on port 3000
npm run dev -w @split/web                # web app on port 5173
```

Settings in `apps/api/.env`: `DATABASE_URL`, `RESEND_API_KEY`, `MAIL_FROM`, `APP_URL`. Never commit `.env`.

Checks: `npm run typecheck` and `npm test`.

## Layout

- `packages/core`: money, split and settle-up logic (pure TypeScript, no database)
- `apps/api`: Fastify and PostgreSQL backend
- `apps/web`: React and Vite web app
