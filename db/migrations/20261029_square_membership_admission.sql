begin;
alter table public.people add column if not exists birthdate date;
alter table public.memberships add column if not exists covered_person_ids uuid[] not null default '{}';
alter table public.square_checkout_attempts drop constraint square_checkout_attempts_kind_check;
alter table public.square_checkout_attempts add constraint square_checkout_attempts_kind_check check(kind in ('membership','class','admission'));
alter table public.checkins
  add column if not exists payment_status text not null default 'legacy' check(payment_status in ('legacy','due','paid','covered','needs_review')),
  add column if not exists square_order_id text,
  add column if not exists square_environment text,
  add column if not exists admission_attempt_id uuid references public.square_checkout_attempts(id);
revoke insert,update,delete on public.checkins from anon,authenticated;
create table public.admission_passes(
  id uuid primary key default gen_random_uuid(),attempt_id uuid not null references public.square_checkout_attempts(id),
  household_id uuid not null references public.households(id),person_id uuid not null references public.people(id),
  visit_date date not null,amount_cents integer not null check(amount_cents>=0),
  status text not null default 'available' check(status in ('available','used','needs_review')),
  used_checkin_id uuid references public.checkins(id),created_at timestamptz not null default now(),unique(attempt_id,person_id)
);
create index admission_pass_lookup on public.admission_passes(person_id,visit_date);
alter table public.admission_passes enable row level security;
grant all on public.admission_passes to service_role;
create table public.admission_pos_sales(
  id uuid primary key default gen_random_uuid(),environment text not null,location_id text not null,
  created_by_user_id uuid not null references auth.users(id),launched_at timestamptz,checkin_ids uuid[] not null,
  amount_cents integer not null check(amount_cents>0),status text not null default 'open' check(status in ('open','paid','needs_review','cancelled')),
  order_id text,created_at timestamptz not null default now(),unique(environment,order_id)
);
alter table public.admission_pos_sales enable row level security;
grant all on public.admission_pos_sales to service_role;
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
    update memberships set square_status=p_status,square_version=p_version,covered_person_ids=coalesce((select array_agg((value->>'id')::uuid) from jsonb_array_elements(a.payload->'assignments')),'{}'::uuid[]),payment_review_required=payment_review_required or p_review,
      renews_at=case when payment_review_required or p_review then least(renews_at,now())
        when p_paid_through is not null then greatest(renews_at,p_paid_through) else renews_at end where id=m.id;
  else
    insert into memberships(household_id,square_customer_id,square_subscription_id,square_environment,square_status,square_version,renews_at,payment_review_required,covered_person_ids)
      values(a.household_id,p_customer,p_subscription,a.environment,p_status,p_version,coalesce(p_paid_through,now()),p_review,coalesce((select array_agg((value->>'id')::uuid) from jsonb_array_elements(a.payload->'assignments')),'{}'::uuid[]));
  end if;
  -- The subscription's customer can differ from an earlier invoice customer for the same household.
  if not exists(select 1 from square_customers where environment=a.environment and household_id=a.household_id) then
    insert into square_customers(household_id,square_customer_id,environment) values(a.household_id,p_customer,a.environment)
      on conflict(square_customer_id) do nothing;
  end if;
  update square_checkout_attempts set status='completed',completed_at=coalesce(completed_at,now()) where id=a.id;
end $$;
create or replace function public.open_play_total_cents(p_birthdates date[], p_adults integer, p_visit_date date)
returns integer language sql immutable set search_path = public as $$
  select case when cardinality(p_birthdates) > 0 then
    (case when exists (select 1 from unnest(p_birthdates) b where b + interval '6 months' <= p_visit_date) then 1600 else 1000 end)
      + greatest(cardinality(p_birthdates) - 1, 0) * 1000
    else 0 end + greatest(p_adults - 2, 0) * 500;
$$;

drop function if exists public.checkin_person(uuid,uuid,text,text,text);
create or replace function public.checkin_person(p_person_id uuid, p_staff_user_id uuid, p_staff_role text, p_source text, p_waiver_version text,p_environment text default 'production')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  person public.people%rowtype;
  today_date date := (now() at time zone 'America/New_York')::date;
  prior_birthdates date[];
  next_birthdates date[];
  prior_adults integer;
  amount integer;
  member boolean;
  checkin_id uuid;
  pass public.admission_passes;
  pay_status text;
begin
  if not exists (select 1 from public.roles where id=p_staff_user_id and role in ('staff','owner','admin'))
    and not exists (select 1 from public.user_roles where user_id=p_staff_user_id and role in ('staff','owner','admin')) then
    return jsonb_build_object('ok',false,'error','Staff access required.','code','forbidden');
  end if;
  select * into person from public.people where id=p_person_id;
  if not found then return jsonb_build_object('ok',false,'error','Person not found.','code','not_found'); end if;
  perform 1 from public.households where id=person.household_id for update;
  if exists (select 1 from public.checkins where person_id=p_person_id and (checked_in_at at time zone 'America/New_York')::date=today_date) then
    return jsonb_build_object('ok',false,'error','Already checked in today.','code','already_checked_in');
  end if;
  if not exists (
    select 1 from public.waivers w where w.household_id=person.household_id
    and w.waiver_version=p_waiver_version and w.signed_at <= now() and w.waiver_expires_at > now()
    and length(trim(w.electronic_signature)) >= 2
    and not exists (select 1 from public.people child where child.household_id=person.household_id and child.role='child' and not (child.id=any(coalesce(w.covered_person_ids,'{}'::uuid[]))))
  ) then return jsonb_build_object('ok',false,'error','A parent or legal guardian must complete the family waiver before check-in.','code','waiver_required'); end if;
  if person.role='child' and (person.birthdate is null or person.birthdate > today_date) then
    return jsonb_build_object('ok',false,'error','Add a valid birthday in My Info/People before check-in.','code','birthday_required');
  end if;
  if exists(select 1 from square_checkout_attempts x,lateral jsonb_array_elements(x.payload->'assignments') r
    where x.household_id=person.household_id and x.environment=p_environment and x.kind='admission' and x.status in ('creating','open')
    and x.payload->'request'->>'visit_date'=today_date::text and r->>'id'=person.id::text) then
    return jsonb_build_object('ok',false,'code','admission_pending','error','Finish or cancel the online admission checkout before checking in or paying at the counter.');
  end if;
  select coalesce(array_agg(p.birthdate) filter(where p.role='child'),'{}'::date[]), count(*) filter(where p.role='adult')
    into prior_birthdates,prior_adults from public.checkins c join public.people p on p.id=c.person_id
    where p.household_id=person.household_id and (c.checked_in_at at time zone 'America/New_York')::date=today_date and not (p.role='child' and c.membership_applied);
  select exists(select 1 from public.memberships m where (m.household_id=person.household_id or m.person_id=person.id) and (m.renews_at is null or m.renews_at > now()) and not m.payment_review_required and (m.square_environment is null or m.square_environment=p_environment) and (m.square_environment is null or person.id=any(m.covered_person_ids))) into member;
  next_birthdates := case when person.role='child' then array_append(prior_birthdates,person.birthdate) else prior_birthdates end;
  amount := public.open_play_total_cents(next_birthdates,prior_adults + case when person.role='adult' then 1 else 0 end,today_date)
    - public.open_play_total_cents(prior_birthdates,prior_adults,today_date);
  if member and person.role='child' then amount:=0; end if;
  select ap.* into pass from admission_passes ap join square_checkout_attempts ca on ca.id=ap.attempt_id
    where ap.person_id=person.id and ap.visit_date=today_date and ap.status='available' and ca.status='completed' and ca.environment=p_environment
    order by ap.created_at limit 1 for update of ap;
  pay_status:=case when amount=0 then 'covered' else 'due' end;
  if pass.id is not null then amount:=0; pay_status:='paid'; end if;
  insert into public.checkins(person_id,household_id,child_id,created_by_user_id,created_by_role,source,price_cents,membership_applied,payment_status,admission_attempt_id)
    values(person.id,person.household_id,case when person.role='child' then person.id end,p_staff_user_id,p_staff_role,p_source,amount,member and person.role='child',pay_status,pass.attempt_id)
    returning id into checkin_id;
  if pass.id is not null then update admission_passes set status='used',used_checkin_id=checkin_id where id=pass.id; end if;
  insert into public.occupancy_events(event_type,delta,created_by) values('checkin_increment',1,p_staff_user_id);
  return jsonb_build_object('ok',true,'checkin_id',checkin_id,'membership_applied',member and person.role='child','price_cents',amount,'payment_status',pay_status,'first_name',person.first_name,'last_name',person.last_name,'birthdate',person.birthdate,'birthday',person.birthdate);
end;
$$;

revoke all on function public.checkin_person(uuid,uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.checkin_person(uuid,uuid,text,text,text,text) to service_role;

create or replace function public.fulfill_square_admission_checkout(p_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare a square_checkout_attempts; r jsonb; receipt integer; summary jsonb;
begin
  perform pg_advisory_xact_lock(hashtext('little-wanderers-square-checkout'));
  select * into strict a from square_checkout_attempts where id=p_id and kind='admission' for update;
  perform 1 from households where id=a.household_id for update;
  if a.status='completed' then return a.payload->'summary'; end if;
  if a.status not in ('creating','open') then raise exception 'Admission payment requires review'; end if;
  select coalesce(sum(amount_cents-refunded_cents),0) into receipt from square_payment_receipts where environment=a.environment and order_id=a.order_id and status='COMPLETED' and refunded_cents=0;
  if receipt <> a.expected_amount_cents then raise exception 'A verified checkout payment is required'; end if;
  for r in select value from jsonb_array_elements(a.payload->'assignments') loop
    insert into admission_passes(attempt_id,household_id,person_id,visit_date,amount_cents)
      values(a.id,a.household_id,(r->>'id')::uuid,(a.payload->'request'->>'visit_date')::date,(r->>'amount_cents')::integer);
  end loop;
  summary:=jsonb_build_object('visit_date',a.payload->'request'->>'visit_date','people',jsonb_array_length(a.payload->'assignments'),'total_price_cents',a.expected_amount_cents);
  update square_checkout_attempts set status='completed',completed_at=now(),payload=payload||jsonb_build_object('summary',summary) where id=a.id;
  return summary;
end $$;
create or replace function public.prepare_admission_pos(p_ids uuid[],p_user uuid,p_environment text,p_location text)
returns public.admission_pos_sales language plpgsql security definer set search_path=public as $$
declare sale admission_pos_sales; total integer;
begin
  perform pg_advisory_xact_lock(hashtext('little-wanderers-admission-pos'));
  if cardinality(p_ids) not between 1 and 30 or cardinality(p_ids)<>(select count(distinct x) from unnest(p_ids) x) then raise exception 'Choose unpaid check-ins'; end if;
  perform 1 from checkins where id=any(p_ids) for update;
  if (select count(*) from checkins where id=any(p_ids) and payment_status='due' and price_cents>0 and (checked_in_at at time zone 'America/New_York')::date=(now() at time zone 'America/New_York')::date)<>cardinality(p_ids) then raise exception 'Check-in amount changed; refresh first'; end if;
  select * into sale from admission_pos_sales where environment=p_environment and status='open' and checkin_ids && p_ids limit 1;
  if found then
    if sale.checkin_ids @> p_ids and p_ids @> sale.checkin_ids and sale.created_by_user_id=p_user then return sale; end if;
    raise exception 'A Square payment is already in progress for these check-ins';
  end if;
  select sum(price_cents) into total from checkins where id=any(p_ids);
  insert into admission_pos_sales(environment,location_id,created_by_user_id,checkin_ids,amount_cents) values(p_environment,p_location,p_user,p_ids,total) returning * into sale;
  return sale;
end $$;
create or replace function public.fulfill_admission_pos(p_id uuid,p_order text,p_amount integer)
returns void language plpgsql security definer set search_path=public as $$
declare sale admission_pos_sales; receipt integer;
begin
  perform pg_advisory_xact_lock(hashtext('little-wanderers-admission-pos'));
  select * into strict sale from admission_pos_sales where id=p_id for update;
  if sale.status='paid' and sale.order_id=p_order then return; end if;
  if sale.status<>'open' or sale.amount_cents<>p_amount then raise exception 'POS payment requires review'; end if;
  if exists(select 1 from square_checkout_attempts where environment=sale.environment and order_id=p_order) then raise exception 'This payment belongs to another checkout'; end if;
  select coalesce(sum(amount_cents-refunded_cents),0) into receipt from square_payment_receipts where environment=sale.environment and order_id=p_order and status='COMPLETED' and refunded_cents=0;
  if receipt<>sale.amount_cents then raise exception 'Verified POS payment is required'; end if;
  if exists(select 1 from checkins where id=any(sale.checkin_ids) and payment_status<>'due') then raise exception 'Check-in payment changed'; end if;
  update admission_pos_sales set status='paid',order_id=p_order where id=sale.id;
  update checkins set payment_status='paid',square_order_id=p_order,square_environment=sale.environment where id=any(sale.checkin_ids);
end $$;
revoke all on function public.fulfill_square_admission_checkout(uuid),public.prepare_admission_pos(uuid[],uuid,text,text),public.fulfill_admission_pos(uuid,text,integer) from public,anon,authenticated;
grant execute on function public.fulfill_square_admission_checkout(uuid),public.prepare_admission_pos(uuid[],uuid,text,text),public.fulfill_admission_pos(uuid,text,integer) to service_role;
notify pgrst,'reload schema';
commit;
