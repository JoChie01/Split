-- 007_owner_and_seats.sql
--
-- WHAT: Adds an owner to each group (the person who created it) and a seat limit
--       (how many people the group has room for, set when the owner makes an invite link).
-- RULES: Only the owner can invite people with a link, remove seats, or change the limit.
--        A seat can't be removed once its person has joined or it appears on any bill or payment.

alter table groups
  add column owner_user_id uuid references users (id) on delete set null,
  add column seat_limit integer check (seat_limit between 2 and 50);

-- Groups made before this migration: the first person who joined becomes the owner.
update groups g
set owner_user_id = (
  select m.user_id from members m
  where m.group_id = g.id and m.user_id is not null
  order by m.created_at
  limit 1
);
