# Non-reserving class pre-registration

Apply `db/migrations/20261021_non_reserving_class_preregistration.sql` before
deploying the accompanying application changes. The new `preregistered` status
must be allowed by the database before either customer or staff intake uses it.

After deploying and verifying the new application, allow any in-flight requests
from the old version to finish, then apply
`db/migrations/20261021_class_preregistration_backfill.sql` once, while official
paid registration is still closed. This normalizes prelaunch `scheduled` and
`waitlist` records for classes starting November 9, 2026 or later and clears old
seat-offer tokens. Review and back up the selection first:

```sql
select registration.id, registration.status, registration.created_by_role,
       registration.created_at, class.title, class.start_time
from public.class_registrations as registration
join public.classes as class on class.id = registration.class_id
where class.start_time >= timestamptz '2026-11-09 00:00:00-05:00'
  and registration.created_at < transaction_timestamp()
  and registration.status in ('scheduled', 'waitlist')
  and coalesce(registration.attendance_status, 'unknown') = 'unknown';
```

The owner confirmed on October 21 that the four manually entered records are
also pre-registration interest. The reviewed production selection contained 23
records in total (19 customer-entered and 4 owner-entered). Preserve the existing
IDs and timestamps so families retain their selected dates and history.

Keep this order: expand the database constraint, deploy the application, finish
the backfill. This captures pre-registrations accepted by the old version during
deployment without pausing customer intake. Do not rerun the backfill after
official registration opens, when `scheduled` may represent confirmed bookings.

Both intake paths save interest without checking capacity or waitlist priority.
The roster includes these records, but seat counts and attendance do not. Cancelling
interest sends cancellation notifications without triggering a seat offer. Retrying
an active record is idempotent; restoring cancelled interest uses `preregistered`.

Staff can read the roster and family links. Owner/admin accounts retain schedule
management. Instructor access remains scoped to assigned classes through `/teaching`.

Official registration and verified payment fulfillment remain a separate release;
the customer online checkout remains disabled by `onlinePaymentsUnavailable()`.
