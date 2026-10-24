/**
 * routes/links.ts
 *
 * WHAT: Shareable links that let a person join a group.
 *   POST /groups/:groupId/links     make a link (members only, lasts 7 days)
 *   GET  /join/:token               the group and its seats (you must be logged in)
 *   POST /join/:token/join          take a seat, or add yourself as a new member (logged in)
 * RULES: A link only lets someone JOIN. Joining means logging in and then choosing a seat
 *        that no one has taken yet, or adding yourself. After that, you use the normal
 *        group routes, which check your membership. Claims and confirmations never happen
 *        through a link.
 *        Payment details are never shown on the join page.
 */
import { createHash, randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Sql } from "../db";
import { accessIn } from "../access";
import { currentUser } from "./auth";

const LINK_DAYS = 7;

const groupParams = z.object({ groupId: z.string().uuid() });
const tokenParams = z.object({ token: z.string().min(20).max(100) });
const joinBody = z.union([
  z.object({ memberId: z.string().uuid() }),
  z.object({ displayName: z.string().trim().min(1).max(60) }),
]);

const UNIQUE_VIOLATION = "23505";

function pgCode(err: unknown): string | undefined {
  if (typeof err === "object" && err !== null && "code" in err && typeof err.code === "string") {
    return err.code;
  }
  return undefined;
}

/** We store only the hash, so the link itself exists only in the person's hands. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** The group a link opens, or undefined if the link is wrong or expired. */
async function groupForToken(sql: Sql, token: string): Promise<string | undefined> {
  const [row] = await sql<{ groupId: string }[]>`
    select group_id as "groupId" from group_links
    where token_hash = ${hashToken(token)} and expires_at > now()`;
  return row?.groupId;
}

export function registerLinkRoutes(app: FastifyInstance, sql: Sql) {
  app.post("/groups/:groupId/links", async (request, reply) => {
    const params = groupParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "Invalid group id" });
    const { groupId } = params.data;

    const who = await accessIn(sql, request, groupId);
    if (!who.ok) return reply.code(who.code).send({ error: who.error });

    const token = randomBytes(32).toString("base64url");
    const [row] = await sql<{ expiresAt: Date }[]>`
      insert into group_links (token_hash, group_id, expires_at)
      values (${hashToken(token)}, ${groupId}, now() + make_interval(days => ${LINK_DAYS}))
      returning expires_at as "expiresAt"`;

    return reply.code(201).send({
      token,
      expiresAt: row!.expiresAt,
      note: "Share this link now. It can't be shown again.",
    });
  });

  app.get("/join/:token", async (request, reply) => {
    const params = tokenParams.safeParse(request.params);
    if (!params.success) return reply.code(404).send({ error: "Link not found or expired" });

    const user = await currentUser(sql, request);
    if (!user) return reply.code(401).send({ error: "Log in first" });

    const groupId = await groupForToken(sql, params.data.token);
    if (!groupId) return reply.code(404).send({ error: "Link not found or expired" });

    const [group] = await sql<{ id: string; name: string }[]>`
      select id, name from groups where id = ${groupId}`;
    // Each seat shows only whether it's taken, never who holds it.
    const seats = await sql<{ id: string; displayName: string; taken: boolean }[]>`
      select id, display_name as "displayName", (user_id is not null) as taken
      from members where group_id = ${groupId}
      order by lower(display_name)`;

    const [mine] = await sql<{ id: string }[]>`
      select id from members where group_id = ${groupId} and user_id = ${user.id}`;

    return { group, seats, alreadyMember: !!mine };
  });

  app.post("/join/:token/join", async (request, reply) => {
    const params = tokenParams.safeParse(request.params);
    if (!params.success) return reply.code(404).send({ error: "Link not found or expired" });

    const user = await currentUser(sql, request);
    if (!user) return reply.code(401).send({ error: "Log in first" });

    const body = joinBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "Pick your name, or type a new one" });

    const groupId = await groupForToken(sql, params.data.token);
    if (!groupId) return reply.code(404).send({ error: "Link not found or expired" });

    const [mine] = await sql<{ id: string }[]>`
      select id from members where group_id = ${groupId} and user_id = ${user.id}`;
    if (mine) return reply.code(409).send({ error: "You're already in this group" });

    try {
      if ("memberId" in body.data) {
        // Take the seat only if nobody has it yet. One statement, so two people can't both win it.
        const [taken] = await sql<{ id: string }[]>`
          update members set user_id = ${user.id}
          where id = ${body.data.memberId} and group_id = ${groupId} and user_id is null
          returning id`;
        if (!taken) return reply.code(409).send({ error: "That name is already taken" });
      } else {
        await sql`
          insert into members (group_id, display_name, user_id)
          values (${groupId}, ${body.data.displayName}, ${user.id})`;
      }
    } catch (err) {
      if (pgCode(err) === UNIQUE_VIOLATION) {
        return reply.code(409).send({ error: "That name is already in this group" });
      }
      throw err;
    }

    return reply.code(201).send({ groupId });
  });
}
