# Public class date checkout

Registration is open to all signed-in families, including families with no saved interest. One checkout covers any combination of the selected child's ordinary class dates from November 16 through December 17, 2026. November 26 is closed. A second child can be selected for a subsequent checkout. Jamie's existing full-series checkout, sibling pricing, deadline, and invoices are separate and unchanged.

The date picker shows the term's available occurrences, saved interest, confirmed dates, individual prices, and a basket total. Selection survives email login in session storage. A pending checkout is restored from the authenticated server after refresh or return from Square. Switching children does not transfer the previous child's basket.

## Payment verification

The formerly dormant `/api/classes/checkout` now serves only this verified class flow. Other dormant payment routes stay disabled. The API restricts every operation to the authenticated family's child and checkout, rejects duplicate dates or quantities above one, checks live schedule/term/holiday, and prices on the server. It never accepts browser payment status or a browser total.

This release reuses the **already installed** service-only `square_checkout_attempts`, `square_payment_receipts`, `square_catalog_mappings` and RPCs `prepare_square_checkout`, `freeze_square_checkout_request`, `save_square_payment_receipt`, `fulfill_square_class_checkout`, and `abandon_uncreated_square_checkout`. No new production schema or payment environment setting is required. A focused test snapshot of the installed SQL lives in `tests/fixtures/class-checkout-installed.sql`; that file is not a production migration.

Preparing a checkout atomically checks capacity and creates a temporary checkout hold. It does not confirm registration. Square requests have a stable idempotency key and frozen body. Every order line includes the chosen date. Payment confirmation fetches the current order and every receipt directly from Square, verifying order reference, location, environment, currency, exact total, zero balance, completed status, and no refunds or tips. Only then does the atomic fulfillment RPC promote existing interest records or create the full set of confirmed registrations.

The signed Square webhook uses the same verifier, independently of the browser. A registration conflict after verified payment records `needs_review` and tells the family to contact staff rather than pay again. Records and receipts remain available in Square and the checkout table for reconciliation.

Pending checkout pages can be resumed or closed. Before releasing a hold, the server closes the Square link and rechecks the order's canceled state and absence of receipts. A payment completed during cancellation is fulfilled instead. Expired checkout cleanup is triggered by the customer checkout API; provider ambiguity retains the hold. Failed link creation is recovered using the exact saved provider request.

## Schedule changes

The owner-approved production update canceled eleven empty occurrences (November 26 and December 21–31), leaving 29 scheduled sessions including Jamie's five. All 85 existing registration records were verified unchanged. General class notes now state the December 17 term end and Thanksgiving closure. Public catalog reads also have an explicit term-end cutoff.

## Validation

Run `node --test tests/class-checkout.test.mjs` for PostgreSQL-backed capacity, pricing, participant, paid fulfillment, preregistration identity, cancellation, retry, API ownership, and webhook checks. Existing class preregistration, series payment, presentation, webhook, and dormant-route regressions are also required. Run the production build and lint before release. Production smoke validation may create and cancel an unpaid checkout for the owner's family, and must not charge a real card.
