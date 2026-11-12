# Private party setting and Open Play availability

Owner/admin users get a **Private party · exclusive use 4–6pm** checkbox in All bookings & requests and Today's parties. Staff can see the private-party badge but cannot save the setting. Checking it closes Open Play at 4pm on the party's Eastern calendar date and blocks overlapping 4–6pm arrival windows. It does not change the party's price, invoice, payment, attendance, or customer notes.

The block is derived from `party_bookings.is_private` and its active status/date. Unchecking, cancelling, or moving a party releases/moves that block automatically; another private party on the old date can still keep it blocked. Manual `open_play_reservation_slots.status` values are never changed by this feature, so an owner's separate manual closure remains closed.

Existing Open Play reservations are never cancelled. The checkbox returns the overlapping families and links to their records, and existing private parties reload that list after a date move. A failed conflict read is explicitly shown as unavailable instead of reporting zero conflicts. Earlier arrivals see the 4pm closing in the reservation calendar and new confirmation email; a reserved arrival that actually overlaps the private period is told to contact the studio to arrange a change. No automatic change/refund/outreach is sent to existing families.

## Required activation order

1. Apply `db/migrations/20261112_private_party_open_play.sql` to the existing production database.
2. Verify the boolean column and service-only functions/triggers. The migration has been tested in isolated PostgreSQL, including direct customer write denial, existing reservation preservation, cancellation, date moves, DST, manual closures, and boundary overlaps.
3. Deploy the application change only after the schema is verified. Without the new availability source, new reservation requests fail closed rather than bypass the private-party check.
4. Mark existing private parties explicitly. In particular, the already identified December 11, 2026 party needs its checkbox enabled. Its previously manually closed 4–6pm slots remain closed; after the private flag is saved, the owner may explicitly change their configured slot status back to open while the derived private block remains active. This lets a later uncheck release them without reopening unrelated manual closures.

Production activation is pending: the Mac was locked and the database management browser could not connect; the owner said unlocking is unavailable for now. No production schema, flag, booking, or slot status was changed by this feature's implementation/validation. The separately approved opening-hours/capacity changes remain live.

## Concurrency and access

A database guard rejects new, restored, or expanded reservations during a private period, including requests that passed an earlier browser/API check. Day advisory locks serialize reservation allocation against private-flag changes, date moves, and cancellation. Existing reservations may still be checked in, reduced, or cancelled. The guard runs before the existing household/slot capacity locks.

The owner endpoint validates authenticated role, boolean input, original flag, original start time, active lifecycle, and a compare-and-save predicate. Direct `anon`/`authenticated` changes to private flags (or movement/cancellation of a private block) are rejected by the database trigger even if old table-level grants exist. Availability helpers are service-only and public responses expose dates/closing times rather than private party identity.

Run `node --test tests/*.test.mjs`, `npm run lint`, and `npm run build` before release. No real customer signature, booking, payment, or email is needed for validation.
