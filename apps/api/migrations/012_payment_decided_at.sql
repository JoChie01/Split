-- 012_payment_decided_at.sql
--
-- WHAT: Records when the receiver confirmed or disputed a payment.
-- WHY:  Receipts of confirmed payments are deleted 3 days after confirmation, so the
--       app needs to know when that was. Payments made before this migration have no time,
--       so their receipts are never deleted automatically (they were kept until now anyway).

alter table payments add column decided_at timestamptz;
