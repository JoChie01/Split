-- 001_init.sql
--
-- WHAT: The first version of Split's database: groups, people, bills and payments.
-- RULES: Money is stored as whole centavos (integers), never decimals.
--        The database refuses nonsense (negative amounts, empty names) on its own.

create table groups (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(trim(name)) > 0),
  created_at timestamptz not null default now()
);

-- People in a group. They don't need an account; payment details are optional.
create table members (
  id             uuid primary key default gen_random_uuid(),
  group_id       uuid not null references groups (id) on delete cascade,
  display_name   text not null check (length(trim(display_name)) > 0),
  payment_method text,   -- e.g. GCash, Maya, BDO
  account_name   text,
  account_number text,
  created_at     timestamptz not null default now()
);

-- Two "Ana"s in one group would be confusing, so names are unique per group.
create unique index members_group_name_unique on members (group_id, lower(display_name));
create index members_group_id_idx on members (group_id);

-- One bill: who paid and how much.
create table expenses (
  id                uuid primary key default gen_random_uuid(),
  group_id          uuid not null references groups (id) on delete cascade,
  paid_by_member_id uuid not null references members (id),
  title             text not null check (length(trim(title)) > 0),
  total_centavos    integer not null check (total_centavos > 0),
  split_mode        text not null check (split_mode in ('equal', 'amount', 'percent', 'items')),
  created_at        timestamptz not null default now()
);

create index expenses_group_id_idx on expenses (group_id);

-- How much of a bill each person owes. The API makes sure the shares add up to the total.
create table expense_shares (
  expense_id      uuid not null references expenses (id) on delete cascade,
  member_id       uuid not null references members (id),
  amount_centavos integer not null check (amount_centavos >= 0),
  primary key (expense_id, member_id)
);

-- Money sent from one person to another. A row is created when proof is submitted,
-- so "unpaid" simply means no payment row yet.
create table payments (
  id             uuid primary key default gen_random_uuid(),
  group_id       uuid not null references groups (id) on delete cascade,
  from_member_id uuid not null references members (id),
  to_member_id   uuid not null references members (id),
  mode           text not null check (mode in ('reimburse', 'treat')),
  status         text not null default 'pending' check (status in ('pending', 'confirmed', 'rejected')),
  created_at     timestamptz not null default now(),
  constraint payments_different_people check (from_member_id <> to_member_id)
);

create index payments_group_id_idx on payments (group_id);

-- Which people's debts a payment covers (yours, plus friends you pay for).
create table payment_allocations (
  payment_id       uuid not null references payments (id) on delete cascade,
  debtor_member_id uuid not null references members (id),
  amount_centavos  integer not null check (amount_centavos > 0),
  primary key (payment_id, debtor_member_id)
);