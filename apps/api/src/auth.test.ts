/**
 * auth.test.ts
 *
 * WHAT: Checks login by email link, the session cookie, and logout.
 *       Emails are captured by a fake mailer, so nothing is really sent.
 * NOTE: Uses the "split_test" database and empties the login tables before each test.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { buildApp } from "./app";
import { createSql } from "./db";
import { runMigrations } from "./migrate";

const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ?? "postgres://localhost:5432/split_test";

const sql = createSql(testDatabaseUrl);

// Every email the app "sends" is kept here instead of going out.
let sent: { to: string; text: string }[] = [];
const app = buildApp({
  rateLimit: false, // these tests request many login links on purpose; the limit has its own tests
  sql,
  appUrl: "http://localhost:5173",
  mailer: async (to, _subject, text) => {
    sent.push({ to, text });
  },
});

beforeAll(async () => {
  await runMigrations(sql);
  await app.ready();
});

beforeEach(async () => {
  sent = [];
  await sql`truncate users, login_links cascade`;
});

afterAll(async () => {
  await app.close();
  await sql.end();
});

/** Asks for a login link and returns the token from the email. */
async function requestLink(email: string): Promise<string> {
  await app.inject({ method: "POST", url: "/auth/request", payload: { email } });
  const token = sent.at(-1)?.text.match(/token=([A-Za-z0-9_-]+)/)?.[1];
  if (!token) throw new Error("no login link was emailed");
  return token;
}

/** Turns a login link into a session cookie value. */
async function logIn(email: string): Promise<string> {
  const token = await requestLink(email);
  const res = await app.inject({ method: "POST", url: "/auth/verify", payload: { token } });
  expect(res.statusCode).toBe(200);
  const cookie = String(res.headers["set-cookie"]);
  const pair = cookie.split(";")[0]; // "split_session=<value>"
  if (!pair) throw new Error("no session cookie was set");
  return pair;
}

describe("POST /auth/request", () => {
  it("emails a login link to the trimmed, lowercased address", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/request",
      payload: { email: "  Ana@Example.com " },
    });

    expect(res.statusCode).toBe(202);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe("ana@example.com"); // trimmed and lowercased
    expect(sent[0]?.text).toContain("http://localhost:5173/login/verify?token=");
  });

  it("refuses something that is not an email address", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/request",
      payload: { email: "not-an-email" },
    });

    expect(res.statusCode).toBe(400);
    expect(sent).toHaveLength(0);
  });

  it("stores only a hash of the token, never the token itself", async () => {
    const token = await requestLink("ana@example.com");
    const rows = await sql<{ tokenHash: string }[]>`
      select token_hash as "tokenHash" from login_links`;
    const row = rows[0];
    if (!row) throw new Error("no login link was stored");

    expect(row.tokenHash).not.toBe(token);
    expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/); // SHA-256 in hex
  });
});

describe("POST /auth/verify", () => {
  it("creates the account, sets a secure HttpOnly cookie, and logs the person in", async () => {
    const token = await requestLink("ana@example.com");
    const res = await app.inject({ method: "POST", url: "/auth/verify", payload: { token } });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ user: { email: "ana@example.com" } });
    const cookie = String(res.headers["set-cookie"]);
    expect(cookie).toMatch(/^split_session=/);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
  });

  it("works only once", async () => {
    const token = await requestLink("ana@example.com");
    const first = await app.inject({ method: "POST", url: "/auth/verify", payload: { token } });
    const second = await app.inject({ method: "POST", url: "/auth/verify", payload: { token } });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(400);
  });

  it("refuses an expired link", async () => {
    const token = await requestLink("ana@example.com");
    await sql`update login_links set expires_at = now() - interval '1 minute'`;

    const res = await app.inject({ method: "POST", url: "/auth/verify", payload: { token } });

    expect(res.statusCode).toBe(400);
  });

  it("refuses a made-up token", async () => {
    await requestLink("ana@example.com");
    const res = await app.inject({
      method: "POST",
      url: "/auth/verify",
      payload: { token: "this-is-not-a-real-login-token-at-all" },
    });

    expect(res.statusCode).toBe(400);
  });
});

describe("GET /me, logout", () => {
  it("answers 401 when nobody is logged in", async () => {
    const res = await app.inject({ method: "GET", url: "/me" });

    expect(res.statusCode).toBe(401);
  });

  it("tells you who is logged in, using the cookie", async () => {
    const cookie = await logIn("ana@example.com");
    const res = await app.inject({ method: "GET", url: "/me", headers: { cookie } });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ email: "ana@example.com" });
  });

  it("logs out: the old cookie stops working", async () => {
    const cookie = await logIn("ana@example.com");
    await app.inject({ method: "POST", url: "/auth/logout", headers: { cookie } });
    const res = await app.inject({ method: "GET", url: "/me", headers: { cookie } });

    expect(res.statusCode).toBe(401);
  });

  it("does not accept a made-up cookie", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/me",
      headers: { cookie: "split_session=fake-session-value-1234567890" },
    });

    expect(res.statusCode).toBe(401);
  });
});
