-- Apply once, AFTER deploying non-reserving intake, while official paid
-- registration is still closed. The owner confirmed that manually entered
-- prelaunch records are also expressions of interest, not confirmed bookings.
begin;

update public.class_registrations as registration
set status = 'preregistered',
    waitlist_offer_token = null,
    waitlist_offer_expires_at = null,
    waitlist_offered_at = null
from public.classes as class
where registration.class_id = class.id
  and class.start_time >= timestamptz '2026-11-09 00:00:00-05:00'
  and registration.created_at < transaction_timestamp()
  and registration.status in ('scheduled', 'waitlist')
  and coalesce(registration.attendance_status, 'unknown') = 'unknown';

commit;
