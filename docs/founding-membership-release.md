# Founding membership: card registration before opening

The unlisted customer entry pages are `/wanderlist-founding` ($50 + $10)
and `/general-founding` ($50 + $20). Both have `noindex, nofollow`
metadata and are absent from the homepage, public navigation, and sitemap.
Anyone given a URL can read the offer; eligibility is verified from the account,
never granted by the URL. Public registration stays gated during the waitlist
phase. An eligible original Wanderlist account gets its $10 sibling rate even
if it enters through the public URL. After the regular phase begins, both entry
pages show regular pricing. `/founding-membership` remains the shared management
URL and supports existing links. The earlier nested entry URLs redirect to the short URLs. Neither entry is linked from the homepage; adding the general link later is an explicit content change, with no scheduled publication.

While founding enrollment is open, each entry keeps its own advertised heading
and price after authentication. A non-Wanderlist account on
`/wanderlist-founding` sees an eligibility/account-switch notice, with no card
form or automatic move to public pricing. The family explicitly chooses whether
to sign in with its original Wanderlist identity or visit `/general-founding`.
General-page checkout still honors an eligible account's better Wanderlist rate
and explains it in the form. Existing enrollment details always show the saved
rates; visiting another entry cannot change them.

Existing accounts reuse their authenticated user, household, and child IDs;
saved contact and child details are prefilled for confirmation. One
`/login?mode=continue&next=...` entry handles both returning and first-time users:
email magic link or SMS verification signs into an existing identity or
automatically provisions a new one, with no account-status/signup selection.
Both methods return to the exact entry URL before family details and card
authorization are completed. Existing families must use their existing email
or a phone already verified on that auth identity. An unverified profile/contact
phone does not grant access to someone else's account. Phone-only users enter a
required contact email in the membership form; this does not change their auth
identity or grant Wanderlist eligibility. The membership API rejects
unauthenticated saves. Email callbacks stay on the entry site's origin, and
failed/expired links retain the membership destination for the next attempt.

## Prices and release order

| Offer | First child/month | Each sibling 6mo+/month | Two eligible children | Savings vs $80 |
| --- | --- | --- | --- | --- |
| Original Wanderlist | $50 | $10 | $60 | 25% |
| Public founding | $50 | $20 | $70 | 12.5% |
| Regular / rejoining after cancellation | $60 | $20 | $80 | — |

Both founding first-child and sibling rates last for the lifetime of the
continuously active membership. There is no commitment and cancellation is
available anytime. Cancellation permanently ends founding eligibility for that
family/account. Rejoining creates a new regular-price reservation; the canceled
record, its authorization, and its paid coverage remain in history.

The owner tool has an explicit enrollment-phase selector: `waitlist` (the
default), then `public`, then `regular` after opening. Original Wanderlist
eligibility uses the existing October 28 cutoff and authenticated account/email
matching. Later website signups cannot claim the $10 sibling rate. During the
public founding phase, original Wanderlist families still qualify for their
earlier offer. After switching to regular, new enrollments use $60 + $20.

Phase changes do not change an existing reserved member's stored tier or rates,
including recovery of a card registration already in progress. They set no
billing start date, create no subscription, and never enable billing. Clients cannot
choose their own discount; the server/database resolve eligibility and reject
stale price authorizations.

## Before accepting cards

1. Apply `20261103_founding_memberships.sql`, then
   `20261103_founding_checkin.sql`. The second migration retains the existing
   check-in function's exact current signature, waiver, paid-pass, environment, audit, pricing, and occupancy checks; it patches only the membership coverage result and refuses an unrecognized function. Apply `20261103_membership_notifications.sql` after the founding table migration. Existing installs also apply `20261103_founding_offer_email_identity_fix.sql`; it avoids an ambiguous email reference on the full operating waitlist schema.
2. Configure `SQUARE_APPLICATION_ID` (or the existing `NEXT_PUBLIC_SQUARE_APPLICATION_ID`) to match the existing environment, access
   token and location. Card storage can be enabled by the private, per-environment `founding_membership_settings.card_enrollment_enabled` setting or `FOUNDING_CARD_ENROLLMENT_ENABLED=true`, only after
   verifying the matching Square Web Payments SDK form. HTTPS is required in
   production. Never use a production card in the sandbox.
3. Keep `FOUNDING_BILLING_ENABLED=false`. No billing start date exists by default.
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
founding rates. Rejoining uses a new reservation at regular $60 + $20 pricing.

## On each family’s first membership visit, after the owner enables billing

There is no cron job, guessed date, or automatic subscription scheduler. Do not
enable billing or populate a date as part of this release.

The owner-only tool is `/staff/founding-memberships`. A future release/operator
step may enable `FOUNDING_BILLING_ENABLED=true` when the studio is ready to activate
visiting families. The owner chooses one family, confirms its arrival for its first
membership visit (including during soft opening), enters that day’s date explicitly,
reviews the action, and types `START MONTHLY BILLING`. The first-visit confirmation
is required by the server. Each family has its own monthly billing anchor. Visiting
or checking in never triggers billing automatically. The server refuses a future or past
date, except a retry of a previously frozen activation. It freezes the chosen
date atomically, then uses stable Square idempotency keys for catalog creation
and subscription creation. Retrying an uncertain activation must use that same
date; never manually create a second subscription. A saved-card registration
has no route to this operation.

The recurring price uses the enrollment's stored tier: Wanderlist $50 + $10,
public founding $50 + $20, or regular $60 + $20. Baby siblings transition through explicit monthly static
Square phases; the final phase repeats without an end date. All phases keep the
stored first-child and sibling prices. No temporary discount or later price
increase is used for an uninterrupted founding membership. The first monthly
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
- Check desktop and mobile `/wanderlist-founding` and
  `/general-founding`, email and phone continuation,
  required real birthdays/contact fields, authorization, saved-card confirmation,
  cancellation, and owner-only billing controls. The mobile page has no horizontal
  overflow at 390px.

Square references: [store a card without a charge](https://developer.squareup.com/docs/web-payments/charge-and-store-cards),
[monthly phases](https://developer.squareup.com/docs/subscriptions-api/plans-and-variations),
[subscription creation](https://developer.squareup.com/reference/square/subscriptions-api/create-subscription),
[cancellation](https://developer.squareup.com/reference/square/subscriptions-api/cancel-subscription).

## Owner membership alerts

A private transactional outbox captures every production founding card reservation
(including waitlist, public, and regular-price rejoining) and new/reactivated
regular memberships. Drafts, failed card setups, sandbox records, ordinary
renewals, and duplicate retries do not send new signup alerts. Each notification
contains the family/parent names, email, phone, and every child's name, birthday,
and age at enrollment, with tier and pricing where available. Recipients use the
existing OWNER_EMAIL fallback configuration.

Enrollment/start routes and the regular Square webhook send queued alerts using
Vercel waitUntil. An exclusive ten-minute delivery lease, stable Resend
idempotency key, and persisted sent marker protect retries. The existing secured
daily reminder job also retries pending membership alerts; its party reminders
continue independently. Notification failures do not undo an enrollment. No raw
card token or provider credentials enter the queue or email.

Owner-only `/api/admin/founding-memberships?verifySquare=1` verifies the configured
Square location with a read-only provider call and reports card configuration,
environment, email configuration, and the closed monthly-billing flag without
exposing credentials. It creates no payment or subscription.

## Production verification — November 3, 2026

- Both short URLs return HTTP 200 with the correct separate advertised prices
  and noindex metadata. Homepage and sitemap include neither link.
- Private production settings allow direct-link registration; original Wanderlist
  eligibility still receives the $10 sibling rate. The public release is
  controlled by sharing the link, without a scheduled homepage change.
- The Square production location and existing-account/family retrieval passed
  authenticated, read-only verification. Card configuration is present; monthly
  billing is disabled, with zero founding billing dates or subscriptions.
- The owner received a clearly labeled integration-test email in Gmail. No
  membership, check-in, payment or subscription was created by that email test.

## First-visit billing policy — November 3, 2026

New authorizations use terms version `2026-11-03-first-visit`. Saving a card takes
no payment and sets no date. The first monthly payment starts on each family’s
first membership visit, including during soft opening, after explicit owner
activation. Visits throughout the soft-opening period are included with the
membership with no separate admission charge; this is not a one-visit benefit.
Old authorization versions cannot be activated under the revised policy. No
production enrollment existed when this policy changed. Billing remains disabled.

## Simplified enrollment — November 4, 2026

Both entry pages share a compact price overview and one sign-in action. Benefits
and detailed policies are collapsed, and the membership header shows only the
brand and help link. Once signed in, families confirm parent details, then
children, then the card authorization. Returning to earlier steps preserves
family inputs. Changing children clears birthday confirmation; going back from
the card step clears card authorization. Square initializes only on the card
step, is destroyed when leaving it, and the final save still uses the existing
validated account/family API. No family fields, required confirmations, prices,
billing controls, or saved account identities are removed. Wanderlist sign-in
starts with the original email; linked phone sign-in remains available with an
explicit explanation. No opening date, subscription or charge is created.


## Owner billing activation — November 13, 2026

The owner explicitly requested enabling billing from the membership dashboard.
The personal owner's server-managed auth app_metadata can now grant
founding_billing_activation.production=true. The grant is environment-specific;
customer-editable user_metadata is never consulted. Existing global environment
enablement remains supported. Production activation stays disabled in preview
deployments. Kiosk and staff sessions cannot enter the owner route. Enabling this
capability itself creates no subscription and takes no payment.

Review billing activation is a read-only action even when activation is disabled.
It retrieves the enrolled child's first actual admission since the consent day,
the saved card from Square, and all pages of that customer's existing subscriptions.
Unvisited families, inactive cards, unresolved subscriptions and stale amounts
cannot proceed. A separate recurring invoice created manually in Square must be
resolved before starting a subscription; the owner confirms this on the review.

The owner reviews the monthly amount, first visit, card last four and next renewal,
checks the confirmation, types START MONTHLY BILLING and clicks the separate final
button. GET/review cannot activate, and POST checks the exact reviewed amount/date
again. Nothing in check-in or the email scheduler calls activation.

Square rejects a past subscription start. For a delayed first activation within
the initial billing period, preserve the actual first visit locally, freeze the
provider's current start date in membership_events before any external write, and
use the existing stable catalog/subscription keys. The initial Square subscription
uses today's billing day to take the full first-month amount. After verifying the
first invoice is fully paid for exactly the authorized amount, schedule the next
renewal on the original first-visit day. The helper accepts the verified future
anchor-change action returned by Square and reuses it after uncertain responses.
Paid coverage is bounded by that scheduled renewal. A missed activation older
than one whole billing period requires separate review. Retrying keeps the same
frozen parameters and never creates a second independent subscription.

Validated with a synthetic Square Sandbox card: a past start was rejected; a
current start charged the full synthetic $1, and changing the renewal anchor
scheduled December 11 after a November 11 visit / November 13 activation, with
one invoice. The synthetic subscription was canceled. No production subscription
or payment was created during verification.
