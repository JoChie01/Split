-- 010_share_total_check.sql
--
-- WHAT: The database refuses a CONFIRMED bill whose shares don't add up to its total.
-- WHY:  The API already checks this, but a bug or a manual edit could skip the API.
--       A rule in the database can't be skipped.
-- WHY ONLY CONFIRMED: Drafts can have unclaimed items, so their shares are partial on purpose.
--       Confirming requires every item to be claimed, so the total must match then.
-- HOW:  The check runs at COMMIT (deferred), so the API can save a bill and its shares
--       in one transaction in any order.
-- NOTE: Confirmed bills from before this migration are not re-checked. Only new changes are checked.

create or replace function check_confirmed_bill_shares() returns trigger
language plpgsql as $$
declare
  eid         uuid;
  bill_status text;
  bill_total  integer;
  shares_sum  bigint;
begin
  if tg_table_name = 'expenses' then
    eid := new.id;
  else
    eid := coalesce(new.expense_id, old.expense_id);
  end if;

  select status, total_centavos into bill_status, bill_total from expenses where id = eid;
  -- The bill may already be gone (its group was deleted). Then there's nothing to check.
  if not found or bill_status <> 'confirmed' then
    return null;
  end if;

  select coalesce(sum(amount_centavos), 0) into shares_sum from expense_shares where expense_id = eid;
  if shares_sum <> bill_total then
    raise exception 'A confirmed bill''s shares add up to % but its total is %', shares_sum, bill_total
      using errcode = 'check_violation';
  end if;
  return null;
end;
$$;

create constraint trigger expense_shares_match_total
  after insert or update or delete on expense_shares
  deferrable initially deferred
  for each row execute function check_confirmed_bill_shares();

create constraint trigger expense_status_matches_shares
  after insert or update on expenses
  deferrable initially deferred
  for each row execute function check_confirmed_bill_shares();
