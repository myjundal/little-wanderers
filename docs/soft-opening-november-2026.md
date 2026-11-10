# Private soft opening reservations

The unlisted invitation URL is `https://www.thelittlewanderers.com/soft-opening`.
The owner shares it by email. This release sends no invitations and adds no public navigation, dashboard card, or sitemap entry. Signing in or creating a website account is required to reserve; Wanderlist emails are recognized, and new website members are also eligible.

Schedule: November 11–15, 2026, 9am–2pm Eastern (last arrival window 1–2pm); November 16–December 31, 9am–5pm Eastern (last arrival window 4–5pm). This includes every calendar day; the owner can close individual dates/windows in the staff reservation workspace. There are 393 one-hour arrival windows, each accepting 5 children. Accompanying adults do not consume child spots; up to two adults are included. Arrival windows are approximate, with no timed departure requirement; visitors may stay until closing.

Admission is $16 for the first child and $10 for each additional child per visit. Founding enrollment covers only the enrolled children, under the existing membership terms (billing begins on the first membership visit). There is no additional soft opening discount. The server calculates and freezes the amount; callers cannot choose a price or claim membership coverage.

Reservation requires guardian first/last name and every participating child's name and age. Existing birthdays are retained; missing ages are collected in years/months using the existing approximate-birthday convention. New children have stable IDs so retrying after a capacity error does not duplicate profiles.

Customers choose Pay at the counter or Pay now. Both reserve the arrival capacity before any payment. Counter reservations redirect directly to the existing family waiver. Pay now explicitly opens a Square hosted checkout with a stable idempotency key and no tipping/coupon options; its return page verifies the stored order and redirects to the waiver. Square webhooks and staff check-in also verify receipts. A redirect query parameter is never payment proof. Paid admission applies to the named children on the reserved Eastern calendar date, preventing a second counter charge. Failed or ambiguous provider verification blocks check-in collection until staff can reconcile it.

Counter reservations can be canceled online. Once online checkout has started, changes/cancellations go through the owner so an open or completed checkout cannot be orphaned. This release does not implement automated refunds or send payment emails.

Deploy the additive `20261109_soft_opening_reservations.sql` migration before the application. It preserves history, refuses to change a schedule with existing future reserved visits, and keeps the installed database capacity locks. Run `node --env-file=/path/to/.env.local scripts/audit-soft-opening.mjs` to verify 393 open windows, capacity 5, and payment columns after applying it. Production checkout links must use the configured HTTPS site origin and production Square environment.

Development-only UI preview: `/soft-opening-preview`. This renders the actual reservation component with fictional availability and never writes bookings or starts payments. It returns 404 in production.

Validation: TypeScript, ESLint, production build; database schedule/capacity, counter/prepaid admission/date/name coverage tests; provider order/receipt/amount/currency/refund checks; existing founding membership, admission desk/POS, family profile, and waiver regression tests. Desktop/mobile UI checks use the same reservation component. Square Sandbox verification created a fictional $26 payment through its hosted testing panel, verified provider receipts twice, and deleted the test link. Digital checkout orders may remain OPEN after payment, so fulfillment checks the completed receipt and zero amount due. No live customer reservation, real charge, signature, or outgoing customer email is created during verification.
