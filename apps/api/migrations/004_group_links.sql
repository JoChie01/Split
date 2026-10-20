-- 004_group_links.sql
--
-- WHAT: Shareable links for a group. We store a hash of each link, never the link itself,
--       so a leaked database can't be used to join a group.

create table group_links (
  token_hash text primary key,
  group_id   uuid not null references groups (id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index group_links_group_id_idx on group_links (group_id);