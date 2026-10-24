-- 005_accounts.sql
--
-- WHAT: Accounts for logging in by email.
--   users        one row per person who has logged in
--   login_links  one-time links sent by email (we store only a hash of each token)
--   sessions     "you are logged in" records (we store only a hash of each token)

create table users (
  id         uuid primary key default gen_random_uuid(),
  email      text not null unique,
  created_at timestamptz not null default now()
);

create table login_links (
  token_hash text primary key,
  email      text not null,
  expires_at timestamptz not null,
  used_at    timestamptz,
  created_at timestamptz not null default now()
);

create table sessions (
  token_hash text primary key,
  user_id    uuid not null references users (id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index sessions_user_id_idx on sessions (user_id);
