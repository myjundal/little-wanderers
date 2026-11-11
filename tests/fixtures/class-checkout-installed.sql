-- Reference snapshot of the service-only class checkout functions already installed in production.
-- This fixture is test-only; it is not a production migration.
create role anon; create role authenticated; create role service_role;
create schema auth; create table auth.users(id uuid primary key);
create table households(id uuid primary key,email text);
create table people(id uuid primary key,household_id uuid,role text,first_name text,birthdate date,created_at timestamptz default now());
create table classes(id uuid primary key,title text,status text,price_cents integer,capacity integer,start_time timestamptz);
create table class_registrations(id uuid primary key default gen_random_uuid(),class_id uuid,person_id uuid,household_id uuid,child_id uuid,status text,created_by_user_id uuid,created_by_role text,waitlist_offer_token uuid,waitlist_offer_expires_at timestamptz,waitlist_offered_at timestamptz,unique(class_id,person_id));
create table square_checkout_attempts(id uuid primary key default gen_random_uuid(),household_id uuid,kind text,environment text,location_id text,expected_amount_cents integer,payload jsonb,status text default 'creating',order_id text,payment_link_id text,payment_url text,square_subscription_id text,created_by_user_id uuid,created_by_role text,created_at timestamptz default now(),completed_at timestamptz,hold_expires_at timestamptz default now()+interval '30 minutes',unique(environment,order_id));
create unique index checkout_one_open on square_checkout_attempts(environment,household_id,kind) where status in ('creating','open');
create table square_payment_receipts(environment text,payment_id text,order_id text,amount_cents integer,refunded_cents integer default 0,status text,provider_updated_at timestamptz default '-infinity',updated_at timestamptz default now(),primary key(environment,payment_id));
create table square_catalog_mappings(environment text,kind text,entity_key text,variation_id text,program_key text,primary key(environment,kind,entity_key));

create or replace function public.prepare_square_checkout(
  p_household uuid, p_kind text, p_environment text, p_location text, p_user uuid, p_role text, p_request jsonb
) returns public.square_checkout_attempts language plpgsql security definer set search_path = public as $$
declare
  a square_checkout_attempts; selected classes; session classes; item jsonb; participant record; registration record;
  assigned jsonb := '[]'; lines jsonb := '[]'; seen jsonb := '{}';
  variation text; program text; billing_key text; session_ids uuid[]; participant_ids uuid[];
  total integer := 0; quantity integer; seats integer; held integer;
  children jsonb; eligible integer; visit date; visitors uuid[]; person_row record; adult_number integer:=0; child_number integer:=0; amount integer;
begin
  perform pg_advisory_xact_lock(hashtext('little-wanderers-square-checkout'));
  select * into a from square_checkout_attempts where household_id=p_household and kind=p_kind
    and environment=p_environment and status in ('creating','open') limit 1;
  if found then
    if a.payload->'request' <> p_request then raise exception 'Finish the existing checkout before starting another'; end if;
    return a;
  end if;
  perform 1 from households where id=p_household for update;
  if p_kind = 'membership' then
    if exists(select 1 from memberships where household_id=p_household and (renews_at is null or renews_at > now()
      or (square_subscription_id is not null and square_status not in ('CANCELED','COMPLETED')))) then
      raise exception 'A membership already exists for this household';
    end if;
    select jsonb_agg(jsonb_build_object('id',id,'birthdate',birthdate) order by id),
      count(*) filter(where birthdate + interval '6 months' <= (now() at time zone 'America/New_York')::date)
      into children,eligible from people where household_id=p_household and role='child';
    if children is null or exists(select 1 from people where household_id=p_household and role='child' and (birthdate is null or birthdate>current_date)) then
      raise exception 'Add valid child birthdays in My Info/People first'; end if;
    if eligible=0 then raise exception 'An infant can only be added to an older sibling membership'; end if;
    total := 6000 + greatest(eligible-1,0)*2000;
    if (p_request->>'quoted_amount_cents')::integer is distinct from total then raise exception 'Membership quote changed; review the current price'; end if;
    assigned := children;
  elsif p_kind = 'admission' then
    visit := (p_request->>'visit_date')::date;
    if visit < (now() at time zone 'America/New_York')::date or visit > (now() at time zone 'America/New_York')::date+90 then raise exception 'Choose a visit date within 90 days'; end if;
    select array_agg(value::uuid order by value::uuid) into visitors from jsonb_array_elements_text(p_request->'person_ids');
    if cardinality(visitors) not between 1 and 20 or cardinality(visitors) <> (select count(distinct x) from unnest(visitors) x) then raise exception 'Choose valid family members'; end if;
    if (select count(*) from people where household_id=p_household and id=any(visitors)) <> cardinality(visitors) then raise exception 'Family member not found'; end if;
    if not exists(select 1 from people where id=any(visitors) and role='child') or not exists(select 1 from people where id=any(visitors) and role='adult') then raise exception 'Choose children and an accompanying adult'; end if;
    for person_row in select p.*, exists(select 1 from memberships m where m.household_id=p_household and (m.square_environment is null or m.square_environment=p_environment) and (m.renews_at is null or m.renews_at >= ((visit+1)::timestamp at time zone 'America/New_York'))
        and not m.payment_review_required and (m.square_environment is null or p.id=any(m.covered_person_ids))) covered
      from people p where p.id=any(visitors) order by p.role desc,p.birthdate asc,p.id loop
      if exists(select 1 from checkins where person_id=person_row.id and (checked_in_at at time zone 'America/New_York')::date=visit) then raise exception 'A selected person is already checked in'; end if;
      if exists(select 1 from admission_passes ap join square_checkout_attempts ca on ca.id=ap.attempt_id where ap.person_id=person_row.id and ap.visit_date=visit and ap.status in ('available','used') and ca.environment=p_environment) then raise exception 'A selected person already has admission for this date'; end if;
      if exists(select 1 from square_checkout_attempts x,lateral jsonb_array_elements(x.payload->'assignments') r
        where x.kind='admission' and x.status in ('creating','open') and x.environment=p_environment and r->>'id'=person_row.id::text and x.payload->'request'->>'visit_date'=visit::text) then raise exception 'Finish the existing admission checkout'; end if;
      if person_row.role='child' then
        if person_row.birthdate is null or person_row.birthdate>visit then raise exception 'Add a valid child birthday'; end if;
        if person_row.covered then amount:=0; else
          child_number:=child_number+1;
          amount:=case when child_number>1 or person_row.birthdate+interval '6 months'>visit then 1000 else 1600 end;
        end if;
      else adult_number:=adult_number+1; amount:=case when adult_number>2 then 500 else 0 end; end if;
      assigned:=assigned || jsonb_build_array(jsonb_build_object('id',person_row.id,'amount_cents',amount));
      if amount>0 then
        lines:=lines || jsonb_build_array(jsonb_build_object('name',case when person_row.role='adult' then 'Open Play additional adult' when amount=1600 then 'Open Play admission' else 'Open Play infant / sibling admission' end,
          'quantity','1','base_price_money',jsonb_build_object('amount',amount,'currency','USD')));
      end if;
      total:=total+amount;
    end loop;
    if total=0 then raise exception 'No admission payment is needed; please check in with staff'; end if;
    if (p_request->>'quoted_amount_cents')::integer is distinct from total then raise exception 'Admission quote changed; review the current price'; end if;
  elsif p_kind = 'class' then
    if not exists(select 1 from people where id=(p_request->>'person_id')::uuid and household_id=p_household) then
      raise exception 'Participant not found in household';
    end if;
    if jsonb_array_length(p_request->'items') = 0 then raise exception 'Classes are required'; end if;
    for item in select value from jsonb_array_elements(p_request->'items') loop
      quantity := (item->>'quantity')::integer;
      if quantity < 1 or quantity > 30 then raise exception 'Invalid class quantity'; end if;
      select * into strict selected from classes where id=(item->>'class_id')::uuid for update;
      if selected.status <> 'scheduled' or selected.price_cents <= 0 then raise exception 'Class is not available for paid booking'; end if;
      select m.variation_id,m.program_key into variation,program from square_catalog_mappings m
        where m.environment=p_environment and m.kind='class' and m.entity_key=selected.id::text;
      if p_environment='production' and variation is null then raise exception 'Production class catalog mapping is missing'; end if;
      billing_key := coalesce('program:' || program,'class:' || selected.id::text);
      if seen ? billing_key then
        if (seen->>billing_key)::integer <> quantity then raise exception 'Program quantities must match'; end if;
        continue;
      end if;
      seen := seen || jsonb_build_object(billing_key,quantity);
      if program is null then
        session_ids := array[selected.id];
      else
        select array_agg(c.id order by c.id) into session_ids from square_catalog_mappings m
          join classes c on m.entity_key=c.id::text
          where m.environment=p_environment and m.kind='class' and m.program_key=program;
        if cardinality(session_ids) < 2 or exists(
          select 1 from square_catalog_mappings m left join classes c on m.entity_key=c.id::text
          where m.environment=p_environment and m.kind='class' and m.program_key=program
            and (c.id is null or m.variation_id<>variation or c.price_cents<>selected.price_cents)
        ) then raise exception 'Program pricing or catalog mapping is inconsistent'; end if;
      end if;
      -- Select the same participants across every occurrence. Never silently substitute a sibling
      -- when the requested child already has a seat or a waitlist entry in one occurrence.
      select array_agg(p.id order by (p.id=(p_request->>'person_id')::uuid) desc,p.created_at,p.id)
        into participant_ids from (
          select p.* from people p where p.household_id=p_household and not exists(
            select 1 from class_registrations r where r.person_id=p.id and r.class_id=any(session_ids)
              and r.status not in ('cancelled','preregistered')
          ) order by (p.id=(p_request->>'person_id')::uuid) desc,p.created_at,p.id limit quantity
        ) p;
      if coalesce(cardinality(participant_ids),0)<>quantity
        or not ((p_request->>'person_id')::uuid=any(participant_ids)) then
        raise exception 'Selected participant is not eligible for every class occurrence';
      end if;
      for session in select * from classes where id=any(session_ids) order by id for update loop
        if session.status<>'scheduled' then raise exception 'A program occurrence is not available'; end if;
        if program is not null and session.start_time<=now() then raise exception 'Program has started; please contact staff'; end if;
        select count(*) into seats from class_registrations where class_id=session.id and status in ('scheduled','attended');
        select count(*) into held from square_checkout_attempts x,
          lateral jsonb_array_elements(x.payload->'assignments') r
          where x.status in ('creating','open') and r->>'class_id'=session.id::text;
        held := held + (select count(*) from jsonb_array_elements(assigned) r where r->>'class_id'=session.id::text);
        if session.capacity is not null and seats+held+quantity>session.capacity then
          raise exception 'Class does not have enough seats for every occurrence';
        end if;
        for participant in select * from people where id=any(participant_ids) order by id loop
          if assigned @> jsonb_build_array(jsonb_build_object('class_id',session.id,'person_id',participant.id)) then
            raise exception 'Duplicate class request';
          end if;
          select r.id,r.status into registration from class_registrations r
            where r.person_id=participant.id and r.class_id=session.id;
          assigned := assigned || jsonb_build_array(jsonb_build_object('class_id',session.id,'person_id',participant.id,
            'child_id',case when participant.role='child' then participant.id else null end,
            'registration_id',registration.id,'registration_status',registration.status));
        end loop;
      end loop;
      lines := lines || jsonb_build_array(jsonb_build_object('quantity',quantity::text,
        'base_price_money',jsonb_build_object('amount',selected.price_cents,'currency','USD'))
        || case when variation is null then jsonb_build_object('name',selected.title) else jsonb_build_object('catalog_object_id',variation) end);
      total := total + selected.price_cents*quantity;
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
returns jsonb language plpgsql security definer set search_path=public as $$
declare a square_checkout_attempts;
begin
  select * into strict a from square_checkout_attempts where id=p_id for update;
  if a.status not in ('creating','open') or (a.kind in ('class','admission') and a.hold_expires_at<=now()) then raise exception 'Checkout expired; please start again'; end if;
  if a.payload ? 'provider_request' then return a.payload->'provider_request'; end if;
  update square_checkout_attempts set payload=payload||jsonb_build_object('provider_request',p_request) where id=p_id;
  return p_request;
end $$;

create or replace function public.abandon_uncreated_square_checkout(p_id uuid)
returns boolean language plpgsql security definer set search_path=public as $$
declare a square_checkout_attempts;
begin
  select * into strict a from square_checkout_attempts where id=p_id for update;
  if a.kind not in ('class','admission') or a.status<>'creating' or a.hold_expires_at>now()
    or a.order_id is not null or a.payload ? 'provider_request' then return false; end if;
  update square_checkout_attempts set status='cancelled' where id=a.id;
  return true;
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
    -- Re-read the live registration: a family can pre-register after checkout was prepared.
    insert into class_registrations(class_id,person_id,household_id,child_id,status,created_by_user_id,created_by_role)
      values((r->>'class_id')::uuid,(r->>'person_id')::uuid,a.household_id,(r->>'child_id')::uuid,'scheduled',
        a.created_by_user_id,a.created_by_role)
      on conflict(class_id,person_id) do update set status='scheduled',waitlist_offer_token=null,
        waitlist_offer_expires_at=null,waitlist_offered_at=null
      where class_registrations.household_id=a.household_id and class_registrations.status in ('preregistered','cancelled')
      returning * into reg;
    if not found then raise exception 'Registration changed; staff review required'; end if;
    ids := ids || to_jsonb(reg.id);
  end loop;
  update square_checkout_attempts set status='completed',completed_at=now(),
    payload=payload || jsonb_build_object('summary',jsonb_build_object('registration_ids',ids,
      'registration_count',jsonb_array_length(ids),'total_price_cents',expected_amount_cents)) where id=a.id;
  return jsonb_build_object('registration_ids',ids,'registration_count',jsonb_array_length(ids),'total_price_cents',a.expected_amount_cents);
end $$;
