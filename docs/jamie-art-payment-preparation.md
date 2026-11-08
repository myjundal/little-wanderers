# Jamie art registration and invoice workflow

The owner review page is `/staff/classes/payments`. Invoice drafts can be prepared without sending email. An owner must review the recipient, children, amount, dates, and policy, tick the confirmation, and click Send before an invoice is emailed. Never call the send action as part of preparing drafts.

## Confirmed terms

- Five Thursday sessions at 5:00–5:45 PM Eastern: November 12, November 19, December 3, December 10, December 17, 2026. No class on November 26 (Thanksgiving).
- $150 for the full series. The second child in a family gets $20 off: two children total $280. A later second-child purchase also receives the discount if the first child already paid. Apply the discount only once for the series.
- Full payment is due November 11 at 5:00 PM Eastern, 24 hours before the first class.
- This series is nonrefundable unless canceled by the instructor.
- Interest does not reserve a place. Spaces are limited; only verified completed payment confirms all five sessions.

## Payment verification and capacity

`class_series_programs.payments_enabled` is the server switch. The new flow is specific to Jamie's series; dormant generic checkout remains blocked. A sale freezes children, family, full-series class IDs, recipient, amount, environment, and terms. A series advisory lock serializes family orders and capacity checks across all five sessions. Drafts do not hold seats. An emailed invoice holds capacity until its deadline; a customer checkout holds it for 20 minutes. Neither is a confirmed registration.

A hold remains counted until Square confirms that the invoice was closed. Never release capacity because a timer expired without first closing the provider invoice. Verified invoice, order, reference, recipient, exact USD amount, completed nonrefunded payment receipts, and zero balance are required before an atomic RPC promotes registrations across all five sessions. Existing interest IDs are preserved. Receipt IDs are unique, and retrying fulfillment is idempotent. A paid invoice that cannot fit current capacity is flagged for owner review rather than confirming excess seats.

Signed Square payment/invoice events verify class sales before the legacy webhook event log so transient failures remain retryable. Authenticated checkout status polling and throttled availability reconciliation also recover completed payments or expired unpaid invoices. Every invoice is reconciled from Square, never from a return URL or client-supplied paid flag.

Sandbox coverage uses fictional customers and a local PGlite database. It exercises a $280 twin invoice through the real Sandbox payment page, all ten resulting session registrations, idempotent verification, and closing unpaid invoices before releasing holds. No production records or real cards are used by the smoke script.
