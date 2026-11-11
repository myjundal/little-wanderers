# Open Play customer confirmations

Successful Open Play bookings schedule a customer confirmation with `waitUntil`, independently of the website inbox notification. The email uses the saved admission amount, Eastern date/weekday and arrival window, selected children, caregiver and guest counts. It distinguishes pending payment from paid or membership-covered admission and links to the family waiver and reservation. No schema migration is required.

The shared Resend transport retries temporary failures with the stable `open-play-confirmation/<reservation-id>` idempotency key. Customer-mail failure is logged without undoing or failing a saved reservation. Recipient priority is the reservation/login email, then the household contact for phone-only accounts.

## One-time morning backfill

The owner authorized existing upcoming reservations to receive confirmation on **November 11, 2026, at 7:00 AM America/New_York (12:00 UTC)**. Do not send these confirmations overnight. The script defaults to a read-only dry run and sending requires an explicit bounded delivery window and production website URL.

Run `scripts/send-open-play-confirmations.mjs` with `--created-before=2026-11-11T12:00:00Z` for a dry run. At the approved time, add `--send --not-before=2026-11-11T12:00:00Z --expires-at=2026-11-11T23:00:00Z --site-url=https://www.thelittlewanderers.com`. Load production configuration through Node's `--env-file`; do not print or copy credentials into the command.

The script rechecks each reservation immediately before delivery and excludes cancelled, checked-in, no-show and past arrivals. It resolves contact email from the booking, household or booking creator's Auth account and skips records without an email. It only includes child names belonging to that household and selected on the booking.

The private `.local/` ledger saves immutable retry payloads and accepted provider IDs. Keep that ledger for retries. New-booking confirmations and this morning batch share provider keys to prevent overlapping sends. Resend retains those keys for 24 hours; the approved one-time window expires before that protection can lapse. A provider `invalid_idempotent_request` means the reservation key was already used with different content and is recorded as already sent, without sending another email. Counts of accepted requests include any provider replays and are not delivery receipts. No customer emails are sent by build or automated tests.
