-- 006_membership.sql
--
-- WHAT: Links a member in a group to a login account.
--   members.user_id is empty for people added by name only (they haven't logged in yet).
--   A person can appear only once per group, and one account can't take two seats in a group.

alter table members
  add column user_id uuid references users (id) on delete set null;

create unique index members_one_seat_per_person
  on members (group_id, user_id)
  where user_id is not null;
