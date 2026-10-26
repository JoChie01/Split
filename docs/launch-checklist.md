# Launch checklist

Status as of 2026-10-26. Items marked **Decided** were agreed with the product owner. Items marked **Open** need a decision, a lawyer's check, or code.

## Data retention (decided)

- **QR code:** uploaded by the person who paid the group's bills. Deleted when the group settles, meaning every balance is zero or the owner closes the group.
- **Payment history** (amounts, dates, status, reference numbers, receipt screenshots): deleted 15 days after the group settles.
- **Audit log:** follows the same 15-day rule as payment history.
- **Account numbers:** not stored. Removed by migration `011_drop_account_details.sql`.
- **Backups:** the retention window for deleted data in backups is **Open**. The Data Privacy Act rules don't give a number, so one must be chosen and written down.

## Legal and privacy (Philippines, RA 10173)

Source: [IRR of RA 10173, as amended, National Privacy Commission](https://privacy.gov.ph/wp-content/uploads/2023/06/IRR_RA-10173-as-amended.pdf). Not legal advice. A lawyer must confirm each item.

- **Open:** written privacy notice: what is collected, why, how long it is kept, and who to contact.
- **Open:** written retention schedule, matching the rules above.
- **Open:** a named person accountable for privacy, reachable by users.
- **Open:** a way for users to ask for erasure of their data, through the app or a contact address.
- **Open:** breach procedure. Notify the Commission and affected people within 72 hours of finding out, when sensitive or identity-related data is likely exposed.
- **Open:** lawyer to confirm the 15-day window and whether the app needs to register with the National Privacy Commission.

## Payments and BSP (gate before public launch)

- **Decided:** the app stays record-only for now. Money goes directly between people in GCash, and the app never holds or routes it.
- **Gate:** before the app is public, recheck with a lawyer whether BSP rules apply to what the app does at that point. Do not add in-app payments or a wallet without this check.

## Security (from the audit, status on `main`)

- Done: authentication and membership checks on every group route; payer-only bill confirmation; share-link tokens redacted from logs; web title; owner-only seat changes.
- Done in branch, pending merge: owner can cancel links; links last 48 hours; login and join rate limits; safety headers and body size limit (`feat/links-ratelimits`).
- Done in branch, pending merge: public `/health/db` removed; audit log (`feat/audit-health`).
- Done in branch, pending merge: database refuses confirmed bills whose shares don't add up (`feat/share-total-check`).
- Done in branch, pending merge: account numbers no longer stored (`feat/no-account-numbers`).
- **Open:** HTTPS and secure cookie settings in production, which depend on the hosting decision.
- **Open:** hosting choice. It affects proxy settings for rate limits and the cookie and CORS setup.
- **Open:** rate limits live in memory, so they reset on restart and don't work across several servers.
- **Open:** audit log has no owner-facing view.
- **Open:** payment amounts are not checked against what each person owes.
- **Open:** QR upload and the screen that shows it to people who owe the payee.
- **Open:** receipt screenshot should be attached when paying, not only after a dispute.

## Before public launch

- Verify a domain with Resend, so login emails reach users other than the account owner.
- Confirm all decisions above with a lawyer.
- Recheck the BSP gate against the app's behaviour at that time.
