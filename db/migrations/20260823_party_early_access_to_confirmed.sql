update public.party_bookings
set
  status = 'confirmed',
  status_updated_at = now()
where status = 'early_access_hold';
