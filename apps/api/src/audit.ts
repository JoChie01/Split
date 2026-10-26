/**
 * audit.ts
 *
 * WHAT: One function that writes a line to the audit log (table audit_events).
 * RULES: Call it after the action succeeds. It records only the action, who did it,
 *        and the ID of what it affected. Never put account numbers or names here.
 */
import type { Sql } from "./db";

export type AuditAction =
  | "link_created"
  | "link_cancelled"
  | "member_joined"
  | "member_removed"
  | "bill_confirmed"
  | "payment_recorded"
  | "payment_confirmed"
  | "payment_disputed"
  | "proof_attached";

export async function recordEvent(
  sql: Sql,
  groupId: string,
  action: AuditAction,
  actorMemberId: string | null,
  targetId: string | null = null,
): Promise<void> {
  await sql`
    insert into audit_events (group_id, actor_member_id, action, target_id)
    values (${groupId}, ${actorMemberId}, ${action}, ${targetId})`;
}
