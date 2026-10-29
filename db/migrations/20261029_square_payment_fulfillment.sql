begin;

-- Additive only. Legacy reservations, payments and customer mappings are not inferred or invoiced.
alter table public.square_customers add column if not exists environment text not null default 'legacy';
create unique index if not exists square_customers_environment_household_key
  on public.square_customers(environment, household_id) where environment <> 'legacy';

create table public.square_catalog_mappings (
  environment text not null check (environment in ('sandbox','production')),
  kind text not null check (kind in ('party','membership','class')),
  entity_key text not null,
  variation_id text not null,
  primary key (environment, kind, entity_key)
);
alter table public.square_catalog_mappings enable row level security;

alter table public.party_bookings
  add column square_environment text check (square_environment in ('sandbox','production')),
  add column square_location_id text,
  add column square_customer_id text,
  add column square_item_variation_id text,
  add column square_invoice_timezone text,
  add column square_order_id text,
  add column square_invoice_id text,
  add column square_invoice_version bigint,
  add column square_invoice_status text,
  add column square_invoice_url text,
  add column deposit_paid_cents integer not null default 0 check (deposit_paid_cents >= 0),
  add column balance_paid_cents integer not null default 0 check (balance_paid_cents >= 0),
  add column payment_review_required boolean not null default false,
  add column payment_hold_expires_at timestamptz,
  add column payment_updated_at timestamptz;
create unique index party_square_invoice_key on public.party_bookings(square_environment,square_invoice_id);
create unique index party_square_order_key on public.party_bookings(square_environment,square_order_id);

alter table public.memberships
  add column square_environment text check (square_environment in ('sandbox','production')),
  add column square_status text,
  add column square_version bigint,
  add column payment_review_required boolean not null default false;

create table public.square_checkout_attempts (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id),
  kind text not null check (kind in ('membership','class')),
  environment text not null check (environment in ('sandbox','production')),
  location_id text not null,
  expected_amount_cents integer not null check (expected_amount_cents > 0),
  payload jsonb not null,
  status text not null default 'creating' check (status in ('creating','open','completed','needs_review','cancelled')),
  order_id text,
  payment_link_id text,
  payment_url text,
  square_subscription_id text,
  created_by_user_id uuid references auth.users(id),
  created_by_role text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique(environment,order_id)
);
create unique index square_checkout_one_open on public.square_checkout_attempts(environment,household_id,kind)
  where status in ('creating','open');
alter table public.square_checkout_attempts enable row level security;

create table public.square_payment_receipts (
  environment text not null check (environment in ('sandbox','production')),
  payment_id text not null,
  order_id text not null,
  amount_cents integer not null,
  refunded_cents integer not null default 0,
  status text not null,
  provider_updated_at timestamptz not null default '-infinity',
  updated_at timestamptz not null default now(),
  primary key (environment,payment_id)
);
alter table public.square_payment_receipts enable row level security;

alter table public.webhook_log
  add column processing_status text not null default 'legacy' check (processing_status in ('legacy','pending','processed','failed')),
  add column processed_at timestamptz,
  add column processing_error text;

-- Browser roles must not be able to forge paid amounts, membership dates or registrations.
-- All existing application writes use authenticated server routes with service-role access.
revoke insert, update, delete on public.party_bookings,public.memberships,public.class_registrations,public.square_customers from anon,authenticated;
grant all on public.square_checkout_attempts,public.square_payment_receipts,public.square_catalog_mappings to service_role;

-- Every slot mutation, including legacy admin inserts/reschedules, participates in the same lock.
-- Expired pending holds keep blocking until Square confirms their invoice was cancelled.
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
  if new.status = 'confirmed'
    and (tg_op = 'INSERT' or old.status <> 'confirmed')
    and (new.square_environment is null or new.deposit_paid_cents < 15000 or new.payment_review_required or new.square_invoice_id is null) then
    raise exception 'A verified Square deposit is required to confirm this booking';
  end if;
  return new;
end $$;
create trigger guard_party_payment_and_slot before insert or update on public.party_bookings
  for each row execute function public.guard_party_payment_and_slot();

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

create or replace function public.prepare_square_checkout(
  p_household uuid, p_kind text, p_environment text, p_location text, p_user uuid, p_role text, p_request jsonb
) returns public.square_checkout_attempts language plpgsql security definer set search_path = public as $$
declare a square_checkout_attempts; c classes; item jsonb; participant record; assigned jsonb := '[]'; lines jsonb := '[]'; variation text;
  total integer := 0; quantity integer; seats integer; held integer; needed integer;
begin
  perform pg_advisory_xact_lock(hashtext('little-wanderers-square-checkout'));
  select * into a from square_checkout_attempts where household_id=p_household and kind=p_kind
    and environment=p_environment and status in ('creating','open') limit 1;
  if found then
    if a.payload->'request' <> p_request then raise exception 'Finish the existing checkout before starting another'; end if;
    return a;
  end if;
  if p_kind = 'membership' then
    if exists(select 1 from memberships where household_id=p_household and (renews_at is null or renews_at > now()
      or (square_subscription_id is not null and square_status not in ('CANCELED','COMPLETED')))) then
      raise exception 'A membership already exists for this household';
    end if;
    total := 6000;
  elsif p_kind = 'class' then
    if not exists(select 1 from people where id=(p_request->>'person_id')::uuid and household_id=p_household) then
      raise exception 'Participant not found in household';
    end if;
    if jsonb_array_length(p_request->'items') = 0 then raise exception 'Classes are required'; end if;
    for item in select value from jsonb_array_elements(p_request->'items') loop
      quantity := (item->>'quantity')::integer;
      if quantity < 1 or quantity > 30 then raise exception 'Invalid class quantity'; end if;
      select * into strict c from classes where id=(item->>'class_id')::uuid for update;
      if c.status <> 'scheduled' or c.price_cents <= 0 then raise exception 'Class is not available for paid booking'; end if;
      select variation_id into variation from square_catalog_mappings where environment=p_environment and kind='class' and entity_key=c.id::text;
      if p_environment='production' and variation is null then raise exception 'Production class catalog mapping is missing'; end if;
      lines := lines || jsonb_build_array(jsonb_build_object('quantity',quantity::text,'base_price_money',jsonb_build_object('amount',c.price_cents,'currency','USD'))
        || case when variation is null then jsonb_build_object('name',c.title) else jsonb_build_object('catalog_object_id',variation) end);
      select count(*) into seats from class_registrations where class_id=c.id and status in ('scheduled','attended');
      select count(*) into held from square_checkout_attempts x,
        lateral jsonb_array_elements(x.payload->'assignments') r
        where x.status in ('creating','open') and r->>'class_id'=c.id::text;
      if c.capacity is not null and seats + held + quantity > c.capacity then raise exception 'Class does not have enough seats'; end if;
      needed := 0;
      for participant in select p.id,p.role,reg.id registration_id,reg.status registration_status from people p
        left join class_registrations reg on reg.person_id=p.id and reg.class_id=c.id
        where p.household_id=p_household and (reg.id is null or reg.status in ('cancelled','preregistered'))
        order by (p.id=(p_request->>'person_id')::uuid) desc,p.created_at,p.id limit quantity loop
        if assigned @> jsonb_build_array(jsonb_build_object('class_id',c.id,'person_id',participant.id)) then
          raise exception 'Duplicate class request';
        end if;
        assigned := assigned || jsonb_build_array(jsonb_build_object('class_id',c.id,'person_id',participant.id,
          'child_id',case when participant.role='child' then participant.id else null end,
          'registration_id',participant.registration_id,'registration_status',participant.registration_status));
        needed := needed + 1;
      end loop;
      if needed <> quantity then raise exception 'Not enough eligible household participants'; end if;
      total := total + c.price_cents * quantity;
    end loop;
  else raise exception 'Invalid checkout type'; end if;
  insert into square_checkout_attempts(household_id,kind,environment,location_id,expected_amount_cents,payload,created_by_user_id,created_by_role)
    values(p_household,p_kind,p_environment,p_location,total,jsonb_build_object('request',p_request,'assignments',assigned,'line_items',lines),p_user,p_role)
    returning * into a;
  return a;
end $$;

create or replace function public.save_square_payment_receipt(
  p_environment text,p_payment text,p_order text,p_amount integer,p_refunded integer,p_status text,p_updated timestamptz
) returns void language plpgsql security definer set search_path = public as $$
begin
  if p_amount <= 0 or p_refunded < 0 or p_refunded > p_amount or p_updated is null then raise exception 'Invalid payment receipt'; end if;
  if exists(select 1 from square_payment_receipts where environment=p_environment and payment_id=p_payment and order_id<>p_order) then
    raise exception 'Payment order mismatch';
  end if;
  insert into square_payment_receipts(environment,payment_id,order_id,amount_cents,refunded_cents,status,provider_updated_at)
    values(p_environment,p_payment,p_order,p_amount,p_refunded,p_status,p_updated)
  on conflict(environment,payment_id) do update set amount_cents=excluded.amount_cents,refunded_cents=greatest(square_payment_receipts.refunded_cents,excluded.refunded_cents),
    status=excluded.status,provider_updated_at=excluded.provider_updated_at,updated_at=now()
    where excluded.provider_updated_at >= square_payment_receipts.provider_updated_at;
end $$;

create or replace function public.freeze_square_checkout_request(p_id uuid,p_request jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a square_checkout_attempts;
begin
  select * into strict a from square_checkout_attempts where id=p_id for update;
  if a.payload ? 'provider_request' then return a.payload->'provider_request'; end if;
  update square_checkout_attempts set payload=payload || jsonb_build_object('provider_request',p_request) where id=p_id;
  return p_request;
end $$;

create or replace function public.fulfill_square_class_checkout(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a square_checkout_attempts; r jsonb; reg class_registrations; ids jsonb := '[]'; c record;
begin
  perform pg_advisory_xact_lock(hashtext('little-wanderers-square-checkout'));
  select * into strict a from square_checkout_attempts where id=p_id and kind='class' for update;
  if a.status='completed' then return a.payload->'summary'; end if;
  if a.status not in ('creating','open') then raise exception 'Checkout needs staff review'; end if;
  if a.order_id is null or coalesce((select sum(amount_cents-refunded_cents) from square_payment_receipts
    where environment=a.environment and order_id=a.order_id and status='COMPLETED'),0) <> a.expected_amount_cents then
    raise exception 'A verified checkout payment is required';
  end if;
  for c in select cl.id,cl.capacity,count(*) needed from jsonb_array_elements(a.payload->'assignments') x
    join classes cl on cl.id=(x->>'class_id')::uuid group by cl.id,cl.capacity loop
    if c.capacity is not null and c.needed + (select count(*) from class_registrations where class_id=c.id and status in ('scheduled','attended')) > c.capacity then
      raise exception 'Paid class no longer has enough seats; staff review required';
    end if;
  end loop;
  for r in select value from jsonb_array_elements(a.payload->'assignments') loop
    perform 1 from classes where id=(r->>'class_id')::uuid and status='scheduled' for update;
    if not found then raise exception 'Paid class is no longer available; staff review required'; end if;
    if r->>'registration_id' is not null then
      select * into strict reg from class_registrations where id=(r->>'registration_id')::uuid for update;
      if reg.status <> r->>'registration_status' then raise exception 'Registration changed; staff review required'; end if;
      update class_registrations set status='scheduled',waitlist_offer_token=null,waitlist_offer_expires_at=null,
        waitlist_offered_at=null where id=reg.id;
    else
      insert into class_registrations(class_id,person_id,household_id,child_id,status,created_by_user_id,created_by_role)
        values((r->>'class_id')::uuid,(r->>'person_id')::uuid,a.household_id,(r->>'child_id')::uuid,'scheduled',
          a.created_by_user_id,a.created_by_role) returning * into reg;
    end if;
    ids := ids || to_jsonb(reg.id);
  end loop;
  update square_checkout_attempts set status='completed',completed_at=now(),
    payload=payload || jsonb_build_object('summary',jsonb_build_object('registration_ids',ids,
      'registration_count',jsonb_array_length(ids),'total_price_cents',expected_amount_cents)) where id=a.id;
  return jsonb_build_object('registration_ids',ids,'registration_count',jsonb_array_length(ids),'total_price_cents',a.expected_amount_cents);
end $$;

create or replace function public.apply_square_membership(
  p_attempt uuid, p_subscription text, p_customer text, p_status text, p_version bigint,
  p_paid_through timestamptz, p_review boolean
) returns void language plpgsql security definer set search_path = public as $$
declare a square_checkout_attempts; m memberships;
begin
  perform pg_advisory_xact_lock(hashtext('little-wanderers-square-checkout'));
  select * into strict a from square_checkout_attempts where id=p_attempt and kind='membership' for update;
  if a.square_subscription_id is distinct from p_subscription then raise exception 'Subscription mapping mismatch'; end if;
  if exists(select 1 from square_customers where environment=a.environment and square_customer_id=p_customer and household_id<>a.household_id) then
    raise exception 'Customer mapping mismatch';
  end if;
  select * into m from memberships where square_subscription_id=p_subscription for update;
  if found then
    if m.household_id is distinct from a.household_id or m.square_environment is distinct from a.environment then raise exception 'Membership mapping mismatch'; end if;
    if m.square_version > p_version then return; end if;
    update memberships set square_status=p_status,square_version=p_version,payment_review_required=payment_review_required or p_review,
      renews_at=case when payment_review_required or p_review then least(renews_at,now())
        when p_paid_through is not null then greatest(renews_at,p_paid_through) else renews_at end where id=m.id;
  else
    insert into memberships(household_id,square_customer_id,square_subscription_id,square_environment,square_status,square_version,renews_at,payment_review_required)
      values(a.household_id,p_customer,p_subscription,a.environment,p_status,p_version,coalesce(p_paid_through,now()),p_review);
  end if;
  -- The subscription's customer can differ from an earlier invoice customer for the same household.
  if not exists(select 1 from square_customers where environment=a.environment and household_id=a.household_id) then
    insert into square_customers(household_id,square_customer_id,environment) values(a.household_id,p_customer,a.environment)
      on conflict(square_customer_id) do nothing;
  end if;
  update square_checkout_attempts set status='completed',completed_at=coalesce(completed_at,now()) where id=a.id;
end $$;

-- Service-role-only functions accept payment evidence solely from the verified server handlers.
revoke all on function public.reserve_party_invoice(uuid,text,text,uuid,text,jsonb) from public,anon,authenticated;
revoke all on function public.apply_party_invoice(uuid,text,text,bigint,text,integer,integer,boolean,text) from public,anon,authenticated;
revoke all on function public.prepare_square_checkout(uuid,text,text,text,uuid,text,jsonb) from public,anon,authenticated;
revoke all on function public.fulfill_square_class_checkout(uuid) from public,anon,authenticated;
revoke all on function public.apply_square_membership(uuid,text,text,text,bigint,timestamptz,boolean) from public,anon,authenticated;
revoke all on function public.freeze_square_checkout_request(uuid,jsonb) from public,anon,authenticated;
revoke all on function public.save_square_payment_receipt(text,text,text,integer,integer,text,timestamptz) from public,anon,authenticated;
grant execute on function public.reserve_party_invoice(uuid,text,text,uuid,text,jsonb) to service_role;
grant execute on function public.apply_party_invoice(uuid,text,text,bigint,text,integer,integer,boolean,text) to service_role;
grant execute on function public.prepare_square_checkout(uuid,text,text,text,uuid,text,jsonb) to service_role;
grant execute on function public.fulfill_square_class_checkout(uuid) to service_role;
grant execute on function public.apply_square_membership(uuid,text,text,text,bigint,timestamptz,boolean) to service_role;
grant execute on function public.freeze_square_checkout_request(uuid,jsonb) to service_role;
grant execute on function public.save_square_payment_receipt(text,text,text,integer,integer,text,timestamptz) to service_role;

notify pgrst, 'reload schema';
commit;
