alter table public.party_bookings
  add column if not exists confirmation_email_sent_at timestamptz,
  add column if not exists two_week_reminder_sent_at timestamptz,
  add column if not exists final_details_email_sent_at timestamptz,
  add column if not exists remaining_balance_cents integer,
  add column if not exists remaining_balance_payment_url text;

alter table public.party_bookings
  drop constraint if exists party_bookings_remaining_balance_cents_check;

alter table public.party_bookings
  add constraint party_bookings_remaining_balance_cents_check
  check (remaining_balance_cents is null or remaining_balance_cents >= 0);

create index if not exists idx_party_bookings_two_week_reminder
  on public.party_bookings(start_time)
  where two_week_reminder_sent_at is null and status <> 'cancelled';

create index if not exists idx_party_bookings_final_details_reminder
  on public.party_bookings(start_time)
  where final_details_email_sent_at is null and status <> 'cancelled';
