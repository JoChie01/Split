/**
 * routes/auth.ts
 *
 * WHAT: Log in by email link, log out, and ask "who am I?".
 *   POST   /auth/request   send a login link to an email address
 *   POST   /auth/verify    trade a login link for a session cookie
 *   POST   /auth/logout    end the session
 *   GET    /me             the logged-in user (401 if nobody is logged in)
 * FLOW: The email link opens the web app, which sends the token here in the body.
 *       The token never appears in a URL the API logs, and email link scanners that
 *       open links in advance can't use up the login.
 * RULES: Only hashes of login and session tokens are stored. Each login link works once
 *        and expires after 15 minutes. Sessions last 30 days.
 */
import { randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Sql } from "../db";
import type { Mailer } from "../mailer";
import { hashToken } from "./links";

export const SESSION_COOKIE = "split_session";
const LINK_MINUTES = 15;
const SESSION_DAYS = 30;

const requestBody = z.object({
  email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
});
const verifyBody = z.object({ token: z.string().min(20).max(100) });

export type AuthOptions = { mailer: Mailer; appUrl: string };

export type CurrentUser = { id: string; email: string };

/** The session token from the cookie header, if one was sent. */
function sessionTokenFrom(request: FastifyRequest): string | undefined {
  const header = request.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === SESSION_COOKIE) return value.join("=");
  }
  return undefined;
}

/** Who is logged in for this request, or undefined. Other routes will call this. */
export async function currentUser(sql: Sql, request: FastifyRequest): Promise<CurrentUser | undefined> {
  const token = sessionTokenFrom(request);
  if (!token) return undefined;
  const [user] = await sql<CurrentUser[]>`
    select u.id, u.email
    from sessions s join users u on u.id = s.user_id
    where s.token_hash = ${hashToken(token)} and s.expires_at > now()`;
  return user;
}

function sessionCookie(value: string, maxAgeSeconds: number): string {
  // HttpOnly: JavaScript on the page can't read it. Secure: only sent over HTTPS.
  // SameSite=Lax: other websites can't send it along with their own requests.
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

export function registerAuthRoutes(app: FastifyInstance, sql: Sql, options: AuthOptions) {
  app.post("/auth/request", async (request, reply) => {
    const body = requestBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "Enter a valid email address" });
    const email = body.data.email;

    const token = randomBytes(32).toString("base64url");
    await sql`
      insert into login_links (token_hash, email, expires_at)
      values (${hashToken(token)}, ${email}, now() + make_interval(mins => ${LINK_MINUTES}))`;

    const link = `${options.appUrl}/login/verify?token=${token}`;
    await options.mailer(
      email,
      "Your Split login link",
      `Tap this link to log in. It works once and expires in ${LINK_MINUTES} minutes:\n\n${link}\n\n` +
        "If you didn't ask for this, you can ignore this email.",
    );

    // Same answer whether or not the address has an account, so nobody can probe for emails.
    return reply.code(202).send({ message: "If that address can use Split, a login link is on its way." });
  });

  app.post("/auth/verify", async (request, reply) => {
    const body = verifyBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "This link is not valid" });

    // One statement marks the link as used only if it is unused and not expired.
    // Two people clicking at the same moment can't both win.
    const [link] = await sql<{ email: string }[]>`
      update login_links set used_at = now()
      where token_hash = ${hashToken(body.data.token)}
        and used_at is null and expires_at > now()
      returning email`;
    if (!link) return reply.code(400).send({ error: "This link has expired or was already used" });

    const [user] = await sql<{ id: string }[]>`
      insert into users (email) values (${link.email})
      on conflict (email) do update set email = excluded.email
      returning id`;

    const sessionToken = randomBytes(32).toString("base64url");
    await sql`
      insert into sessions (token_hash, user_id, expires_at)
      values (${hashToken(sessionToken)}, ${user.id}, now() + make_interval(days => ${SESSION_DAYS}))`;

    reply.header("set-cookie", sessionCookie(sessionToken, SESSION_DAYS * 24 * 60 * 60));
    return { user: { id: user.id, email: link.email } };
  });

  app.post("/auth/logout", async (request, reply) => {
    const token = sessionTokenFrom(request);
    if (token) {
      await sql`delete from sessions where token_hash = ${hashToken(token)}`;
    }
    reply.header("set-cookie", sessionCookie("", 0)); // tell the browser to forget the cookie
    return { ok: true };
  });

  app.get("/me", async (request, reply) => {
    const user = await currentUser(sql, request);
    if (!user) return reply.code(401).send({ error: "Not logged in" });
    return user;
  });
}
