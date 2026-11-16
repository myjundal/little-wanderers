# Void admission payment

After checking a family in, use **Void payment — $0** in the completion dialog or Family payment panel. Choose Complimentary visit or Class cancelled. This waives only today’s unpaid admission for the selected family; visits, attendance, check-in times, occupancy and departures remain unchanged. It never refunds or replaces a completed Square payment.

Apply `db/migrations/20261116_void_admission_payment.sql` before deploying. The service-only function shares the existing POS transaction lock, checks the complete current family total, and records original visits/fees, reason, staff identity and request ID in a private audit table in the same transaction as changing the fee to zero and status to covered. An open POS sale, linked receipt, prepaid/paid visit or online checkout prevents the void. Staff must reconcile an existing Square checkout first. Same-request retries are idempotent; changed totals, families, days and requests fail without partial writes. Existing membership and included adult/infant admission remain included.

The endpoint requires a normal staff/owner login or active staff PIN session and same-origin requests. Actor, environment and date are derived on the server. Anonymous/customer roles cannot invoke the function or read the audit. The UI displays Void · $0 after a successful void; current revenue projections treat covered visits as zero while retaining attendance.

Release status: implementation and SQL are prepared. The production migration must be applied through the owner’s authenticated Supabase SQL Editor; the connected Mac is currently locked. Do not merge/deploy until the function and private permissions have been verified in production. No customer visit, void, refund or charge is created during release testing.
