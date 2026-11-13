# First-visit membership billing emails

The owner authorized sending billing-start notices to the six reviewed visiting
families on November 13, 2026, and subsequent first-visit notices at 8 PM Eastern.
This workflow sends transactional email only. It never starts subscriptions,
charges cards, changes membership status, or changes attendance.

Run `node --env-file=.env.local scripts/send-membership-billing-notices.mjs` to
preview the nightly selection. The website runs the same notification planner and sender. A GitHub-hosted
schedule calls the protected website endpoint at 8 PM America/New_York, including
daylight saving time. A missed first-visit notice from November 13
onward remains due on a later run. Older visits require an explicit reviewed
batch. Each notice includes the enrolled children, first membership visit date,
and monthly price, and says Square will send a receipt after processing payment.

Only production enrollments with accepted first-visit billing terms, saved card,
and an actual enrolled child's admission check-in qualify. A visit before the
enrollment date, a reservation, or an adult-only check-in is insufficient.
Cancelled, incomplete and complimentary memberships are excluded. Missing
contacts or uncertain prices appear in the review output and are not emailed.

The existing `membership_events` table stores a deterministic event per enrollment
with action `billing_start_email_notice`. Its notes contain a frozen email body,
provider idempotency key, send lease, and delivery submission ID. Compare-and-set
claims prevent simultaneous runs from sending twice. Successful notices are
skipped permanently. Uncertain delivery retries reuse the same provider payload
and key for at most 23 hours; later uncertainty requires manual provider review.
Never remove these audit events to force another send.

For a user-reviewed catch-up batch, preview with `--preview-reviewed --ids=<ids>`,
then use `--send-reviewed --ids=<ids> --expected-total-cents=<total>` only when
the user authorized those recipients and rates. Do not use catch-up mode in the
nightly automation. No credentials are stored in this document or the audit log.

The schedule and email sender run on hosted servers; no Mac or desktop app is
required. Scheduled runs can be delayed by the hosting scheduler. The website
returns only aggregate counts to the workflow logs. The existing local chat
automation must be paused after the hosted dry run succeeds. The owner remains
responsible for performing the actual billing in Square.

The only GitHub secret is MEMBERSHIP_NOTICE_TRIGGER_TOKEN, a purpose-bound HMAC
credential derived on the production website. Supabase and Resend credentials
remain on the website server. A personal owner session can provision this narrow
credential via POST /api/admin/membership-billing-notices with action
provision_scheduler_token. Do not print or commit the token. Rotating the server
Resend key requires reprovisioning this job token. Manual workflow runs default
to a preview; nightly runs send only due, not-yet-notified memberships.

Validation: `node --test tests/membership-billing-notices.test.mjs`.
