-- 011_drop_account_details.sql
--
-- WHAT: Stops storing account names and account numbers (GCash, bank, Maya).
-- WHY:  Storing them creates a risk if the database leaks, and the app doesn't need them.
--       Members share their number another way, and the app keeps only the payment method name.
-- NOTE: Any values already stored in these two columns are deleted by this migration.
--       The app stored them only in testing, not for real users yet.

alter table members
  drop column account_name,
  drop column account_number;
