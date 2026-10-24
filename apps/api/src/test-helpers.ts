/**
 * test-helpers.ts
 *
 * WHAT: Shortcuts for the tests only. The real app logs people in with an email link;
 *       these helpers make a session directly, so each test can act as a named person.
 *       Nothing here is imported by the real server.
 */
import { randomBytes } from "node:crypto";
import type { Sql } from "./db";
import { hashToken } from "./routes/links";

/** Creates the account if needed, and returns a session cookie for it. */
export async function sessionCookie(sql: Sql, email: string): Promise<string> {
  const [user] = await sql<{ id: string }[]>`
    insert into users (email) values (${email})
    on conflict (email) do update set email = excluded.email
    returning id`;
  if (!user) throw new Error("could not create the test user");

  const token = randomBytes(32).toString("base64url");
  await sql`
    insert into sessions (token_hash, user_id, expires_at)
    values (${hashToken(token)}, ${user.id}, now() + interval '1 day')`;
  return `split_session=${token}`;
}

/** Puts an account into a seat that was added by name only. */
export async function takeSeat(sql: Sql, memberId: string, email: string): Promise<void> {
  await sql`
    update members set user_id = (select id from users where email = ${email})
    where id = ${memberId}`;
}
