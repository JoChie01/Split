/**
 * access.ts
 *
 * WHAT: Answers "who is asking, and are they in this group?"
 * RULES:
 *   - Not logged in            -> 401 (log in first)
 *   - Logged in, not a member  -> 404 (same answer as a group that doesn't exist,
 *                                 so nobody can find out which groups exist)
 */
import type { FastifyRequest } from "fastify";
import type { Sql } from "./db";
import { currentUser } from "./routes/auth";

export type Access =
  | { ok: true; memberId: string; userId: string; isOwner: boolean }
  | { ok: false; code: 401 | 404; error: string };

export async function accessIn(sql: Sql, request: FastifyRequest, groupId: string): Promise<Access> {
  const user = await currentUser(sql, request);
  if (!user) return { ok: false, code: 401, error: "Log in first" };

  const [row] = await sql<{ memberId: string; isOwner: boolean }[]>`
    select m.id as "memberId",
           coalesce(g.owner_user_id = m.user_id, false) as "isOwner"
    from members m join groups g on g.id = m.group_id
    where m.group_id = ${groupId} and m.user_id = ${user.id}`;
  if (!row) return { ok: false, code: 404, error: "Group not found" };

  return { ok: true, memberId: row.memberId, userId: user.id, isOwner: row.isOwner };
}
