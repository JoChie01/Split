/**
 * routes/groups.ts
 *
 * WHAT: Endpoints for groups and the people in them.
 *   POST /groups                    create a group (you must be logged in; you become its first member)
 *   GET  /me/groups                 the groups you belong to
 *   GET  /groups/:groupId           a group with its members (members only)
 *   POST /groups/:groupId/members   add a person by name (members only)
 * RULES: Everything that comes in is checked with zod first. Values reach SQL only
 *        as parameters (${...}), never glued into the query text.
 *        Only members of a group can see or change it. Others get "not found".
 * PRIVACY: Account names and numbers are saved, but NOT sent back to anyone.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Sql } from "../db";
import { accessIn } from "../access";
import { currentUser } from "./auth";

const groupParams = z.object({ groupId: z.string().uuid() });

const newGroup = z.object({
  name: z.string().trim().min(1).max(100),
  yourName: z.string().trim().min(1).max(60),
});

const newMember = z.object({
  displayName: z.string().trim().min(1).max(60),
  paymentMethod: z.string().trim().min(1).max(40).optional(),
  accountName: z.string().trim().min(1).max(100).optional(),
  accountNumber: z.string().trim().min(1).max(60).optional(),
});

type GroupRow = { id: string; name: string; createdAt: Date };
type MemberRow = {
  id: string;
  displayName: string;
  paymentMethod: string | null;
  isYou: boolean;
};

// PostgreSQL error codes we want to turn into friendly answers.
const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";

function pgCode(err: unknown): string | undefined {
  if (typeof err === "object" && err !== null && "code" in err && typeof err.code === "string") {
    return err.code;
  }
  return undefined;
}

export function registerGroupRoutes(app: FastifyInstance, sql: Sql) {
  app.post("/groups", async (request, reply) => {
    const user = await currentUser(sql, request);
    if (!user) return reply.code(401).send({ error: "Log in first" });

    const body = newGroup.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: "Invalid group", issues: body.error.issues });
    }

    // The group and its first member are saved together, or not at all.
    const group = await sql.begin(async (tx) => {
      const [row] = await tx<GroupRow[]>`
        insert into groups (name) values (${body.data.name})
        returning id, name, created_at as "createdAt"`;
      await tx`
        insert into members (group_id, display_name, user_id)
        values (${row!.id}, ${body.data.yourName}, ${user.id})`;
      return row!;
    });
    return reply.code(201).send(group);
  });

  app.get("/me/groups", async (request, reply) => {
    const user = await currentUser(sql, request);
    if (!user) return reply.code(401).send({ error: "Log in first" });

    return sql<GroupRow[]>`
      select g.id, g.name, g.created_at as "createdAt"
      from groups g join members m on m.group_id = g.id
      where m.user_id = ${user.id}
      order by g.created_at desc`;
  });

  app.get("/groups/:groupId", async (request, reply) => {
    const params = groupParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "Invalid group id" });
    const { groupId } = params.data;

    const who = await accessIn(sql, request, groupId);
    if (!who.ok) return reply.code(who.code).send({ error: who.error });

    const [group] = await sql<GroupRow[]>`
      select id, name, created_at as "createdAt" from groups where id = ${groupId}`;

    const members = await sql<MemberRow[]>`
      select id,
             display_name   as "displayName",
             payment_method as "paymentMethod",
             (id = ${who.memberId}) as "isYou"
      from members
      where group_id = ${groupId}
      order by created_at, display_name`;
    return { ...group, members };
  });

  app.post("/groups/:groupId/members", async (request, reply) => {
    const params = groupParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "Invalid group id" });
    const { groupId } = params.data;

    const who = await accessIn(sql, request, groupId);
    if (!who.ok) return reply.code(who.code).send({ error: who.error });

    const body = newMember.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: "Invalid member", issues: body.error.issues });
    }
    const m = body.data;

    try {
      const [member] = await sql<MemberRow[]>`
        insert into members (group_id, display_name, payment_method, account_name, account_number)
        values (${groupId}, ${m.displayName}, ${m.paymentMethod ?? null},
                ${m.accountName ?? null}, ${m.accountNumber ?? null})
        returning id,
                  display_name   as "displayName",
                  payment_method as "paymentMethod",
                  false          as "isYou"`;
      return reply.code(201).send(member);
    } catch (err) {
      // The database enforces these rules; we just translate its answer.
      if (pgCode(err) === UNIQUE_VIOLATION) {
        return reply.code(409).send({ error: "That name is already in this group" });
      }
      if (pgCode(err) === FOREIGN_KEY_VIOLATION) {
        return reply.code(404).send({ error: "Group not found" });
      }
      throw err;
    }
  });
}
