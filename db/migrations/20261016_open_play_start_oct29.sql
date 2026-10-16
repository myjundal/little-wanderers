begin;
-- Preserve existing reservation records; only prevent new bookings before October 29.
update public.open_play_reservation_slots
set status='closed'
where is_soft_opening=true and status='open'
  and starts_at < timestamptz '2026-10-29 00:00:00 America/New_York';
alter table public.open_play_reservation_slots drop constraint if exists soft_opening_minimum_date;
alter table public.open_play_reservation_slots add constraint soft_opening_minimum_date
check (not is_soft_opening or status <> 'open' or starts_at >= timestamptz '2026-10-29 00:00:00 America/New_York');
commit;
