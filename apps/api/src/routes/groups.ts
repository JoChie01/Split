/**
 * routes/groups.ts
 *
 * WHAT: Endpoints for groups and the people in them.
 *   POST /groups                    create a group (you must be logged in; you become its first member)
 *   GET  /me/groups                 the groups you belong to
 *   GET  /groups/:groupId           a group with its members (members only)
 *   POST /groups/:groupId/members   add a person by name (members only)
 *   DELETE /groups/:groupId/members/:memberId   remove a seat (owner only)
 * RULES: Everything that comes in is checked with zod first. Values reach SQL only
 *        as parameters (${...}), never glued into the query text.
 *        Only members of a group can see or change it. Others get "not found".
 *        The owner (whoever created the group) can also remove seats. A seat can be
 *        removed only if its person hasn't joined and isn't on any bill or payment.
 * PRIVACY: Account names and numbers are not accepted or stored. Only the payment method's name is kept.
 *          Only the owner sees which seats have joined.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Sql } from "../db";
import { accessIn } from "../access";
import { currentUser } from "./auth";
import { recordEvent } from "../audit";

const groupParams = z.object({ groupId: z.string().uuid() });

const newGroup = z.object({
  name: z.string().trim().min(1).max(100),
  yourName: z.string().trim().min(1).max(60),
});

const memberParams = groupParams.extend({ memberId: z.string().uuid() });

// Only the payment method's name is kept. Account names and numbers are not accepted or stored.
const newMember = z.object({
  displayName: z.string().trim().min(1).max(60),
  paymentMethod: z.string().trim().min(1).max(40).optional(),
});

type GroupRow = { id: string; name: string; createdAt: Date };
type GroupDetailRow = GroupRow & { seatLimit: number | null };
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
        insert into groups (name, owner_user_id) values (${body.data.name}, ${user.id})
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

    const [group] = await sql<GroupDetailRow[]>`
      select id, name, created_at as "createdAt", seat_limit as "seatLimit"
      from groups where id = ${groupId}`;

    const rows = await sql<(MemberRow & { joined: boolean })[]>`
      select id,
             display_name   as "displayName",
             payment_method as "paymentMethod",
             (id = ${who.memberId}) as "isYou",
             (user_id is not null)  as "joined"
      from members
      where group_id = ${groupId}
      order by created_at, display_name`;

    // Only the owner sees who has joined. Everyone else sees the list of names.
    const members = rows.map(({ joined, ...m }) => (who.isOwner ? { ...m, joined } : m));
    return { ...group, isOwner: who.isOwner, members };
  });

  app.delete("/groups/:groupId/members/:memberId", async (request, reply) => {
    const params = memberParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "Invalid id" });
    const { groupId, memberId } = params.data;

    const who = await accessIn(sql, request, groupId);
    if (!who.ok) return reply.code(who.code).send({ error: who.error });
    if (!who.isOwner) return reply.code(403).send({ error: "Only the group's owner can remove seats" });
    if (memberId === who.memberId) return reply.code(409).send({ error: "You can't remove your own seat" });

    // Check and delete in one transaction. The row lock stops someone joining in between.
    const outcome = await sql.begin(async (tx) => {
      const [target] = await tx<{ joined: boolean }[]>`
        select (user_id is not null) as joined from members
        where id = ${memberId} and group_id = ${groupId}
        for update`;
      if (!target) return "missing" as const;
      if (target.joined) return "joined" as const;

      const [used] = await tx<{ used: boolean }[]>`
        select exists (
          select 1 from expenses where paid_by_member_id = ${memberId}
          union all select 1 from expense_shares where member_id = ${memberId}
          union all select 1 from expense_item_sharers where member_id = ${memberId}
          union all select 1 from payments
            where from_member_id = ${memberId} or to_member_id = ${memberId}
          union all select 1 from payment_allocations where debtor_member_id = ${memberId}
        ) as used`;
      if (used?.used) return "used" as const;

      await tx`delete from members where id = ${memberId}`;
      return "removed" as const;
    });

    if (outcome === "missing") return reply.code(404).send({ error: "Seat not found" });
    if (outcome === "joined") {
      return reply.code(409).send({ error: "They've joined, so this seat can't be removed" });
    }
    if (outcome === "used") {
      return reply.code(409).send({ error: "They're on a bill or payment, so this seat can't be removed" });
    }
    await recordEvent(sql, groupId, "member_removed", who.memberId, memberId);
    return reply.code(204).send();
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
        insert into members (group_id, display_name, payment_method)
        values (${groupId}, ${m.displayName}, ${m.paymentMethod ?? null})
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
