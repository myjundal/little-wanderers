create role anon; create role authenticated; create role service_role;
create table households(id uuid primary key,name text,email text);
create table square_customers(household_id uuid,environment text,square_customer_id text,unique(environment,household_id));
create table party_bookings(id uuid primary key default gen_random_uuid(),household_id uuid,start_time timestamptz,end_time timestamptz,headcount_expected int,notes text,birthday_child_name text,birthday_age int,occasion_details text,status text default 'pending',created_at timestamptz default now(),updated_at timestamptz default now(),price_quote_cents int,square_environment text,square_location_id text,payment_hold_expires_at timestamptz,created_by_user_id uuid,created_by_role text,square_order_id text,square_customer_id text,square_item_variation_id text,square_invoice_timezone text,square_invoice_id text,square_invoice_version bigint,square_invoice_status text,square_invoice_url text,deposit_paid_cents int default 0,balance_paid_cents int default 0,status_updated_at timestamptz,payment_updated_at timestamptz,payment_review_required boolean default false,remaining_balance_cents int,remaining_balance_payment_url text,confirmation_email_sent_at timestamptz);
create or replace function public.reserve_party_invoice(
  p_household uuid, p_environment text, p_location text, p_user uuid, p_role text, p_booking jsonb
) returns public.party_bookings language plpgsql security definer set search_path = public as $$
declare b party_bookings;
begin
  perform pg_advisory_xact_lock(hashtext('little-wanderers-party-slots'));
  if p_environment not in ('sandbox','production') then raise exception 'Invalid environment'; end if;
  if (p_booking->>'start_time')::timestamptz <= now()
    or (p_booking->>'end_time')::timestamptz <= (p_booking->>'start_time')::timestamptz then
    raise exception 'Invalid future party time';
  end if;
  select * into b from party_bookings where household_id = p_household
    and start_time = (p_booking->>'start_time')::timestamptz and end_time = (p_booking->>'end_time')::timestamptz
    and status <> 'cancelled' order by created_at desc limit 1;
  if found then
    if b.square_environment = p_environment and b.status = 'pending' then return b; end if;
    raise exception 'This reservation already exists; it will not be charged automatically';
  end if;
  insert into party_bookings(household_id,start_time,end_time,headcount_expected,notes,birthday_child_name,
    birthday_age,occasion_details,status,status_updated_at,price_quote_cents,created_by_user_id,created_by_role,
    square_environment,square_location_id,square_item_variation_id,square_invoice_timezone,payment_hold_expires_at)
  values(p_household,(p_booking->>'start_time')::timestamptz,(p_booking->>'end_time')::timestamptz,
    (p_booking->>'headcount_expected')::integer,p_booking->>'notes',p_booking->>'birthday_child_name',
    (p_booking->>'birthday_age')::integer,p_booking->>'occasion_details','pending',now(),30000,p_user,p_role,
    p_environment,p_location,p_booking->>'variation_id',p_booking->>'timezone',now() + interval '30 minutes') returning * into b;
  return b;
end $$;

create or replace function public.apply_party_invoice(
  p_id uuid, p_environment text, p_invoice_id text, p_version bigint, p_status text,
  p_deposit integer, p_balance integer, p_review boolean, p_url text
) returns public.party_bookings language plpgsql security definer set search_path = public as $$
declare b party_bookings;
begin
  perform pg_advisory_xact_lock(hashtext('little-wanderers-party-slots'));
  select * into strict b from party_bookings where id = p_id for update;
  if b.square_environment is distinct from p_environment or b.square_invoice_id is distinct from p_invoice_id then raise exception 'Invoice mapping mismatch'; end if;
  if b.square_invoice_version is not null and b.square_invoice_version > p_version then return b; end if;
  if p_deposit not between 0 and 15000 or p_balance not between 0 and 15000 then raise exception 'Invalid paid amount'; end if;
  update party_bookings set square_invoice_version = p_version, square_invoice_status = p_status,
    square_invoice_url = coalesce(p_url,square_invoice_url), deposit_paid_cents = p_deposit, balance_paid_cents = p_balance,
    payment_review_required = p_review or (status = 'cancelled' and p_deposit > 0), payment_updated_at = now(),
    remaining_balance_cents = 30000 - p_deposit - p_balance,
    remaining_balance_payment_url = coalesce(p_url,square_invoice_url),
    status = case when status = 'cancelled' then status
      when p_status = 'CANCELED' and p_deposit = 0 and p_balance = 0 then 'cancelled'
      when p_deposit = 15000 and not p_review then 'confirmed' else status end,
    status_updated_at = case when status = 'pending' and (p_deposit = 15000 or p_status = 'CANCELED') then now() else status_updated_at end
  where id = b.id returning * into b;
  return b;
end $$;

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

create trigger guard_party_payment_and_slot before insert or update on party_bookings for each row execute function guard_party_payment_and_slot();
revoke all on party_bookings from public,anon,authenticated;
revoke all on function reserve_party_invoice(uuid,text,text,uuid,text,jsonb) from public,anon,authenticated;
revoke all on function apply_party_invoice(uuid,text,text,bigint,text,integer,integer,boolean,text) from public,anon,authenticated;
