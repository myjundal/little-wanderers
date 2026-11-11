# Family departures and visit duration reports

The check-in desk separates families awaiting arrival, currently visiting families, and fully departed families. Waiting reservations use bold black text. The current visitor list includes walk-ins, members, paid guests, and unpaid guests independently of reservation and payment status.

**Check out family** records departure for the guests shown as currently present, using their saved check-in IDs. Each guest's departure is an existing `occupancy_events` row with `event_type=manual_decrement` and `metadata.source=admission_checkout_v1`. Its deterministic UUID derives from the check-in ID. A single bulk insert with `ON CONFLICT DO NOTHING` commits all new departures and their crowd-count deltas together; concurrent and repeated requests cannot subtract the same guest twice or overwrite the first departure time. No database migration is required.

The staff-only checkout API validates one household, real check-in IDs, and today's Eastern arrival date. Operator identity and departure time come from the server. It uses the crowd view's effective date, and arrivals already removed by a manual crowd reset receive a zero delta. Use family checkout for departures; manual crowd adjustments remain available for unrelated corrections. Checkout does not mark payment paid, cancel reservations, or change pricing. Departed unpaid families remain selectable for payment. The existing one-check-in-per-person-per-day rule remains in effect.

The desk refreshes arrivals and departures every minute when no admission/payment operation is running, and on returning to the page. Current elapsed times update every minute. A failed departure read disables checkout until current status is available. A saved checkout whose follow-up refresh fails remains safe to retry.

## Statistics

Reports accept Eastern date ranges up to 93 days and read all check-in pages, with a 15,000-record safety bound that asks for a shorter range instead of returning partial statistics. Checkout times are loaded by deterministic event ID.

- A completed family visit contains all known check-ins for one household on one Eastern date, with every guest checked out.
- Family stay runs from the earliest arrival to the latest departure. Average and longest stay use fully completed family visits only.
- Guest-hours sum each guest's actual arrival-to-departure time, including completed guests in a partly departed family.
- Missing or invalid departure times are never estimated. Historical visits without departure records are counted separately and excluded from duration metrics.
- CSV contains the completed family-visit rows and Eastern times, with quoted fields and spreadsheet formula-prefix protection.

Verification uses isolated PostgreSQL fixtures and example-only browser layouts. Production schema and report compatibility are checked read-only; no customer visit, departure, waiver or payment is created during verification.
