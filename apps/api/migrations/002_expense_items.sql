-- 002_expense_items.sql
--
-- WHAT: The lines on a receipt. Each item has a price and the people who shared it.
-- WHY: Item splits need to remember what was ordered, not only the final shares.

create table expense_items (
  id              uuid primary key default gen_random_uuid(),
  expense_id      uuid not null references expenses (id) on delete cascade,
  name            text not null check (length(trim(name)) > 0),
  price_centavos  integer not null check (price_centavos >= 0),
  position        integer not null check (position >= 0)
);

create index expense_items_expense_id_idx on expense_items (expense_id);

-- Who shared each item. Splitting one item between people means several rows here.
create table expense_item_sharers (
  item_id   uuid not null references expense_items (id) on delete cascade,
  member_id uuid not null references members (id),
  primary key (item_id, member_id)
);