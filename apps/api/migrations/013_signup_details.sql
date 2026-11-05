-- 013_signup_details.sql
--
-- WHAT: Keeps the name a person gives when they sign up, and when they agreed to the privacy notice.
-- WHY:  The group sees the name. The agreement is a record of consent for the privacy notice.
--       Login links carry these details until the link is used.

alter table login_links add column name text;
alter table login_links add column privacy_accepted_at timestamptz;
alter table users add column name text;
alter table users add column privacy_accepted_at timestamptz;
