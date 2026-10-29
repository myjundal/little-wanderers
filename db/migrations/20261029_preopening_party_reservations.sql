begin;

create or replace function public.guard_party_payment_and_slot()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtext('little-wanderers-party-slots'));
  if new.status <> 'cancelled' and (tg_op = 'INSERT' or new.start_time is distinct from old.start_time
      or new.end_time is distinct from old.end_time or old.status = 'cancelled') then
    if exists (select 1 from party_bookings b where b.id <> new.id and b.status <> 'cancelled'
      and b.start_time < new.end_time and b.end_time > new.start_time) then
      raise exception 'That party slot is already booked';
    end if;
  end if;
  -- Existing pre-opening reservations collect no payment and remain on the legacy server flow.
  -- Square-backed bookings retain the verified-deposit requirement.
  if tg_op='UPDATE' and old.square_environment is not null and
    (new.square_environment is distinct from old.square_environment
      or (old.square_order_id is not null and new.square_order_id is distinct from old.square_order_id)
      or (old.square_invoice_id is not null and new.square_invoice_id is distinct from old.square_invoice_id)) then
    raise exception 'Square invoice associations cannot be removed or replaced';
  end if;
  if new.status = 'confirmed'
    and (tg_op = 'INSERT' or old.status <> 'confirmed')
    and (new.square_environment is not null or new.square_order_id is not null or new.square_invoice_id is not null
      or new.deposit_paid_cents<>0 or new.balance_paid_cents<>0)
    and (new.square_environment is null or new.deposit_paid_cents < 15000 or new.payment_review_required or new.square_invoice_id is null) then
    raise exception 'A verified Square deposit is required to confirm this booking';
  end if;
  return new;
end $$;

notify pgrst, 'reload schema';
commit;
