-- 008_payment_flow.sql
--
-- WHAT: Adds what the cash payment flow needs:
--   reference  the GCash/Maya/bank reference the sender typed in
--   proof      a screenshot the sender attaches after a dispute (PNG or JPEG, max 2 MB)
--   status     "disputed" = the receiver said they didn't get the money
-- RULES: A reference can be used only once per group, so the same transfer can't be claimed twice.

alter table payments
  add column reference  text check (length(trim(reference)) >= 4),
  add column proof      bytea check (length(proof) <= 2097152),
  add column proof_type text check (proof_type in ('image/png', 'image/jpeg'));

alter table payments drop constraint payments_status_check;
alter table payments add constraint payments_status_check
  check (status in ('pending', 'confirmed', 'rejected', 'disputed'));

create unique index payments_reference_unique
  on payments (group_id, lower(reference))
  where reference is not null;
