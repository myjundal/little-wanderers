# Multiple Open Play visits

Families can keep several upcoming Open Play reservations. The customer page at
`/landing/open-play` lists upcoming visits in arrival order and keeps the booking
form available underneath. Each visit retains its own waiver link, payment state,
payment action and existing cancellation policy. The owner family booking flow
also allows additional visits.

An existing active reservation blocks only the same household and arrival slot.
The partial unique index remains the final duplicate guard. Cancelled visits can
be booked again, subject to availability. Slot capacity, availability, last-arrival
cutoffs, private-party closures, authentication and family ownership still apply.

Apply `20261118_multiple_open_play_reservations.sql` before releasing the app. It
removes only the legacy household-wide rejection from the installed capacity
function, retaining the locking, capacity checks, unique index and other triggers.
It fails if the expected function body differs and is safe to apply twice. It
does not update any customer, reservation, visit, payment or membership rows.

Validation: API and React regressions exercise an additional visit, duplicate
window rejection, multiple visible reservations and per-reservation cancellation.
PGlite tests apply the prior migrations followed by this migration twice and
check preserved reservations, multiple visits, duplicate rejection, capacity,
closed windows, private-party closures and rebooking after cancellation.
