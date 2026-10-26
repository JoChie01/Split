/**
 * server.ts
 *
 * WHAT: Starts the API. Run it with `npm run dev -w @split/api`.
 * CONFIG: Settings come from environment variables (see .env.example).
 */
import { buildApp } from "./app";
import { createSql } from "./db";
import { resendMailer } from "./mailer";
import { purgeExpiredReceipts } from "./receipts";

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "127.0.0.1"; // only your own computer can reach it

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set. Copy .env.example to .env first.");
  process.exit(1);
}

const sql = createSql(databaseUrl);
// Email service for login links. Without a key, login links can't be sent (see mailer.ts).
const resendKey = process.env.RESEND_API_KEY;
const mailer = resendKey
  ? resendMailer(resendKey, process.env.MAIL_FROM ?? "Split <onboarding@resend.dev>")
  : undefined;

const app = buildApp({
  logger: true,
  sql,
  mailer,
  appUrl: process.env.APP_URL ?? "http://localhost:5173",
});
// Delete receipts of confirmed payments after 3 days. Checked once an hour.
const receiptTimer = setInterval(() => {
  purgeExpiredReceipts(sql).catch((err) => app.log.error(err));
}, 60 * 60 * 1000);

app.addHook("onClose", async () => {
  clearInterval(receiptTimer);
  await sql.end(); // close the database connection when the server stops
});

try {
  await app.listen({ port, host });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}