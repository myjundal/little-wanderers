# Fully open refresh — November 16, 2026

New admission prices apply from November 16 Eastern: under six calendar months free, six through eleven months $10, twelve months and older $16 for the first child and $10 for additional children six months or older. Existing completed receipts and provider checkouts retain their frozen totals. Future unpaid counter quotes refresh against the children’s ages on the visit date. Staff check-in and counter collection use the same age bands.

New membership enrollment uses the existing regular phase ($60 plus $20 per eligible sibling). Apply `20261116_general_membership.sql` or update the existing settings phase through the service role before release. Saved founding enrollments retain their contracted tier and rates. The existing membership sibling age policy is unchanged.

Party booking uses the already installed service-only `reserve_party_invoice` and `apply_party_invoice` functions. No new party enum or SQL migration is required. One $300 Square invoice requests a $150 deposit now and the balance one day before the party; no automatic card charge is scheduled. A provider-verified completed deposit confirms the date. Pending checkout holds last thirty minutes; expiration cancels the payable invoice before releasing the date and retains the hold if provider state is uncertain. The customer can resume/check/close an unpaid checkout, and view the remaining balance invoice after confirmation. Existing legacy bookings remain visible.

If SQUARE_PARTY_ITEM_VARIATION_ID is configured, its USD $300 catalog variation is validated. Otherwise the server supplies a USD $300 custom invoice line. The deployed Square environment/location credentials remain authoritative. Confirmation requires matching invoice, order, customer, location, currency, payment schedule and completed amounts. Webhook reconciliation is idempotent and retryable. Owner pending status changes verify or close the invoice rather than bypass payment; pending dates cannot be moved while payable.

The displayed crowd level combines checked-in Open Play guests and current party child/adult counts. Expected party headcounts are not treated as attendance. Finalized and out-of-window parties are excluded.

Customer class choices are Pay at counter and Pay now to confirm your seat. Counter selections retain the existing unpaid pre-registration state and explain that payment confirms a seat, subject to availability. Historical interests and paid seats are preserved.

The cafe menu follows the supplied A4 menu, plus Fire x Forge cookies/brownies, mango juice and the listed $1 snacks. Obsolete launch announcements redirect to current Open Play or monthly membership pages; Grand opening coming soon remains without a date.

Validation covers calendar-month boundaries, family pricing, preserved receipts, combined occupancy, invoice identity, partial/full payment, unpaid cancellation, overlapping holds, authentication and family ownership, plus the full regression suite and production build. The invoice SQL under tests/fixtures is a test snapshot of existing installed functions, not a release migration.

Square Sandbox integration verified a real fictional invoice with two $150 requests and canceled its unpaid invoice. The test used an isolated local PostgreSQL database and a synthetic customer, with no production booking, card charge or customer email.
