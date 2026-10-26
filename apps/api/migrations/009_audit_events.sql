-- 009_audit_events.sql
--
-- WHAT: A log of important actions in a group: who confirmed a bill, who sent or
--       disputed a payment, who made or cancelled a link, who joined, who was removed.
-- WHY:  When someone disputes a balance later, we can see what happened and when.
-- RULES: Rows are only added, never edited. They go away only if the group is deleted.
--        Account details are never stored here, only the action and the people involved as IDs.

create table audit_events (
  id              uuid primary key default gen_random_uuid(),
  group_id        uuid not null references groups (id) on delete cascade,
  actor_member_id uuid references members (id) on delete set null,
  action          text not null check (action in (
    'link_created', 'link_cancelled', 'member_joined', 'member_removed',
    'bill_confirmed', 'payment_recorded', 'payment_confirmed', 'payment_disputed', 'proof_attached'
  )),
  target_id       uuid,
  created_at      timestamptz not null default now()
);

create index audit_events_group_id_idx on audit_events (group_id, created_at);
