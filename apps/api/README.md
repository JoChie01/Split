# api

The backend and database. Fastify 5, Zod 4 and PostgreSQL. It uses `packages/core` for all money math.

## Run it

```
cp .env.example .env              # then fill in the values
npm run migrate -w @split/api     # create or update the tables
npm run dev -w @split/api         # port 3000
npm test -w @split/api            # needs a PostgreSQL test database
```

Settings in `.env`: `DATABASE_URL`, `RESEND_API_KEY`, `MAIL_FROM`, `APP_URL`. Never commit `.env`. Tests read `TEST_DATABASE_URL`, or use a local `split_test` database if it is not set.

## Routes

- **Accounts:** `POST /auth/request`, `POST /auth/verify`, `POST /auth/logout`, `GET /me`
- **Groups:** `POST /groups`, `GET /me/groups`, `GET /groups/:groupId`, `POST /groups/:groupId/members`, `DELETE /groups/:groupId/members/:memberId`
- **Join links:** `POST` and `DELETE /groups/:groupId/links`, `GET /join/:token`, `POST /join/:token/join`
- **Bills:** `POST` and `GET /groups/:groupId/expenses`, `GET /groups/:groupId/expenses/:expenseId`, item claims, and `POST .../confirm`
- **Payments:** `POST` and `GET /groups/:groupId/payments`, `POST .../confirm`, `POST .../dispute`, and `POST` and `GET .../proof` for the receipt

Database changes live in `migrations/`, applied in order by `npm run migrate`.
