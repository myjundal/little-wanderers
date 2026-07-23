begin;

alter table public.checkins
  add column if not exists checkin_session_id uuid,
  add column if not exists payment_status text,
  add column if not exists square_pos_transaction_id text,
  add column if not exists square_pos_client_transaction_id text,
  add column if not exists payment_recorded_at timestamptz;

alter table public.checkins
  drop constraint if exists checkins_payment_status_check;

alter table public.checkins
  add constraint checkins_payment_status_check
  check (
    payment_status is null or
    payment_status in ('membership', 'prepaid', 'walkin_paid', 'square_pos_paid', 'included')
  );

create index if not exists idx_checkins_checkin_session_id on public.checkins(checkin_session_id);
create index if not exists idx_checkins_square_pos_transaction_id on public.checkins(square_pos_transaction_id);

commit;
