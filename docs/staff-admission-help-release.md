# Staff admission help release

Status: implementation and local verification complete; production database migration and live browser verification remain pending. Do not deploy the application before applying the migration.

## Apply and enable

1. In the existing Supabase project SQL Editor, run `db/migrations/20261114_staff_admission_help.sql` as one transaction. This only adds private tables/functions; it does not edit existing customer rows.
2. Confirm OpenAPI exposes `staff_admission_cases`, `staff_admission_actions`, `staff_link_admission_receipt`, and `staff_link_admission_waiver`. Anonymous/authenticated browser roles must have no direct table or RPC access.
3. Deploy the accompanying application change. Keep the existing staff authentication, Square credentials, and webhook/callback settings.
4. Use a staff login/PIN to confirm the help panel and shared review queue load. Verify an empty query cannot trigger receipt linking and an unsigned/missing waiver cannot be marked completed.
5. Use a genuinely unlinked, completed receipt only when its family/amount is known. Verify its Square payment/order, admission allocation, date, staff audit, unpaid-list removal, preserved checkout, and service-date revenue once connected. No test charge is necessary.
6. Confirm a known signed guest waiver with its guardian before using the manual mapping action. Do not reassign an arbitrary real customer record for a smoke test. Local PostgreSQL regression tests cover the write path without customer data.

## Verified locally

- 101 focused PostgreSQL, provider, UI interaction, identity, admission/POS and revenue tests pass.
- ESLint, TypeScript and production build pass.
- PostgreSQL tests cover transactional rollback, source-account/history exclusions, duplicate/partial child mappings, retention of existing birthdays and signed snapshots, receipt reuse, refunds, pending POS checkouts, and browser-role denial.
- UI interaction tests cover required confirmation, rapid double clicks, child mapping/birthday differences, stale search results after switching families, and persistent review notes.
- Live browser/visual verification could not run because the Mac was locked and the browser page APIs returned an initialization error. Supabase migration has not been applied.

## Recovery

If enabling the application fails, roll back the application deployment while keeping these additive private tables/functions. Existing pricing, visits, receipts and signatures are unchanged by the schema migration. Successful staff operations retain their actor and before-state audit. Do not delete the audit tables to undo a customer correction; review the individual recorded action and restore only the affected references if necessary.
