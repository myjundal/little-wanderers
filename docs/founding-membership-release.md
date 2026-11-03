# Founding membership: card registration before opening

The unlisted customer page is `/founding-membership`. It has `noindex, nofollow`
metadata and is absent from the homepage, public navigation, and sitemap. This is
an unlisted offer, not an access-controlled secret: anyone given its URL can read it.
Existing accounts use their existing family; new accounts use the same email
authentication flow and return to this page to complete the full family profile.

## Before accepting cards

1. Apply `20261103_founding_memberships.sql`, then
   `20261103_founding_checkin.sql`. The second migration retains the existing
   check-in function's waiver, audit, pricing, and occupancy checks and adds
   founding membership coverage.
2. Configure `SQUARE_APPLICATION_ID` to match the existing environment, access
   token and location. Set `FOUNDING_CARD_ENROLLMENT_ENABLED=true` only after
   verifying the matching Square Web Payments SDK form. HTTPS is required in
   production. Never use a production card in the sandbox.
3. Keep `FOUNDING_BILLING_ENABLED=false`. No opening date exists by default.
   Registration stores a customer/card in Square, a complete family profile and
   versioned authorization locally, and the card's brand/last four digits. No
   raw card number, CVV, or token is persisted. It creates no subscription,
   payment link, payment, or invoice, and does not grant a paid membership term.
4. Configure Square subscription.created, subscription.updated and invoice
   events for the existing signed webhook URL. Reconciliation retrieves provider
   state and only extends admission coverage after the latest invoice is fully
   paid. Failed writes return an error so Square can retry. The founding handler
   runs before the legacy webhook log's duplicate guard.

Families with a production reservation can reserve an available soft-opening
slot through `/landing/soft-opening`. Their enrolled children receive free
admission for the reserved day. Waivers and capacity rules still apply. Saving a
sandbox card never grants real admission. Existing Wanderlist/party access is
preserved.

Enrolled families can manage/cancel at the same URL and see a link in their own
dashboard. A pending reservation cancels locally without any financial API call.
When billing is active, cancellation is confirmed only after Square cancellation
succeeds; paid access lasts through the already-paid term. Cancellation ends the
founding rate, and the same reservation cannot be re-enrolled as a founder.

## On the actual opening day, after the owner decides to start billing

There is no cron job, guessed date, or automatic subscription scheduler. Do not
enable billing or populate a date as part of this release.

The owner-only tool is `/staff/founding-memberships`. A future release/operator
step may enable `FOUNDING_BILLING_ENABLED=true` once the actual opening day is
known. The owner must enter that day's date explicitly, choose a family, review
the action, and type `START MONTHLY BILLING`. The server refuses a future or past
date, except a retry of a previously frozen activation. It freezes the chosen
date atomically, then uses stable Square idempotency keys for catalog creation
and subscription creation. Retrying an uncertain activation must use that same
date; never manually create a second subscription. A saved-card registration
has no route to this operation.

The recurring price is $50 for the oldest child plus $20 per sibling age six
months or older. Baby siblings transition through explicit monthly static
Square phases; the final phase repeats without an end date. All phases keep the
$50 base. No temporary discount or $60 fallback phase is used. The first monthly
total depends on the children's ages at activation and is covered by the stored
authorization. Adding/removing children after enrollment is an owner-assisted
change; changing My Info/People alone does not change the enrollment's frozen
child list or Square price schedule.

## Verification

- `npm run build`
- `node --test tests/*.test.mjs`
- `node scripts/test-founding-card-sandbox.mjs` with sandbox credentials only:
  its network allowlist permits only customer/card endpoints, and its family
  database is in-memory. It creates a sandbox customer/card but no payment or
  subscription. It refuses production credentials/environments.
- Check desktop and mobile `/founding-membership`, both account entry links,
  required real birthdays/contact fields, authorization, saved-card confirmation,
  cancellation, and owner-only billing controls. The mobile page has no horizontal
  overflow at 390px.

Square references: [store a card without a charge](https://developer.squareup.com/docs/web-payments/charge-and-store-cards),
[monthly phases](https://developer.squareup.com/docs/subscriptions-api/plans-and-variations),
[subscription creation](https://developer.squareup.com/reference/square/subscriptions-api/create-subscription),
[cancellation](https://developer.squareup.com/reference/square/subscriptions-api/cancel-subscription).
