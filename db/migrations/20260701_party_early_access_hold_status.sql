alter table public.party_bookings
  drop constraint if exists party_bookings_status_check;

alter table public.party_bookings
  add constraint party_bookings_status_check
  check (status in ('pending', 'confirmed', 'cancelled', 'early_access_hold'));
