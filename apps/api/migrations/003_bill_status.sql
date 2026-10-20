-- 003_bill_status.sql
--
-- WHAT: Bills start as drafts. Only confirmed bills count toward balances and payments.
--       Also stores the item-split fee and how it is shared.

alter table expenses
  add column status text not null default 'draft' check (status in ('draft', 'confirmed')),
  add column extras_centavos integer not null default 0 check (extras_centavos >= 0),
  add column extras_mode text not null default 'proportional' check (extras_mode in ('proportional', 'equal'));

-- Bills created before this migration were already in use, so they count as confirmed.
update expenses set status = 'confirmed';