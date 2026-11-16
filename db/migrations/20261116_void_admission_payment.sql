begin;
create table public.admission_payment_voids (
  id uuid primary key,
  household_id uuid not null references public.households(id),
  actor_id uuid not null references auth.users(id),
  environment text not null check(environment in ('production','sandbox')),
  visit_date date not null,
  checkin_ids uuid[] not null,
  reason text not null check(length(trim(reason)) between 5 and 500),
  original_amount_cents integer not null check(original_amount_cents>0),
  before_records jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.admission_payment_voids enable row level security;
revoke all on public.admission_payment_voids from public,anon,authenticated;
grant all on public.admission_payment_voids to service_role;

create function public.void_admission_payment(p_id uuid,p_actor uuid,p_family uuid,p_ids uuid[],p_environment text,p_reason text,p_expected_total integer)
returns jsonb language plpgsql security definer set search_path=public as $$
declare prior admission_payment_voids; expected uuid[]; total integer; before_rows jsonb; visitors uuid[]; today date := (now() at time zone 'America/New_York')::date;
begin
  if not exists(select 1 from roles where id=p_actor and role in ('owner','admin','staff'))
    and not exists(select 1 from user_roles where user_id=p_actor and role in ('owner','admin','staff')) then raise exception 'Staff access required'; end if;
  if p_id is null or p_family is null or coalesce(p_environment,'') not in ('sandbox','production')
    or coalesce(length(trim(p_reason)),0) not between 5 and 500 or p_expected_total is null or p_expected_total<=0
    or p_ids is null or cardinality(p_ids) not between 1 and 30 or cardinality(p_ids)<>(select count(distinct id) from unnest(p_ids) id) then raise exception 'Choose this family unpaid admission and a reason'; end if;
  -- Same lock order as prepare_admission_pos and receipt fulfillment: either a void or a payment wins.
  perform pg_advisory_xact_lock(hashtext('little-wanderers-admission-pos'));
  select * into prior from admission_payment_voids where id=p_id;
  if found then
    if prior.household_id<>p_family or prior.actor_id<>p_actor or prior.environment<>p_environment
      or prior.visit_date<>today or prior.reason<>trim(p_reason) or prior.original_amount_cents<>p_expected_total
      or not(prior.checkin_ids @> p_ids and p_ids @> prior.checkin_ids) then raise exception 'Void request changed. Refresh the family'; end if;
    return jsonb_build_object('voided',true,'amount_cents',0,'voided_cents',prior.original_amount_cents,'already_voided',true);
  end if;
  perform 1 from households where id=p_family for update;
  perform 1 from checkins c join people p on p.id=c.person_id where p.household_id=p_family
    and (c.checked_in_at at time zone 'America/New_York')::date=today order by c.id for update of c;
  if (select count(*) from checkins c join people p on p.id=c.person_id where c.id=any(p_ids) and p.household_id=p_family
      and (c.household_id is null or c.household_id=p_family) and (c.checked_in_at at time zone 'America/New_York')::date=today
      and c.checked_in_at<=now() and c.payment_status='due' and c.price_cents>0 and c.square_order_id is null
      and coalesce(c.square_environment,'production')=p_environment)<>cardinality(p_ids) then
    raise exception 'Admission changed, was already paid, or belongs to another visit. Refresh before voiding';
  end if;
  select array_agg(c.id order by c.id),sum(c.price_cents),jsonb_agg(to_jsonb(c)),array_agg(c.person_id)
    into expected,total,before_rows,visitors from checkins c join people p on p.id=c.person_id
    where p.household_id=p_family and (c.checked_in_at at time zone 'America/New_York')::date=today
      and c.payment_status='due' and c.price_cents>0;
  if expected is null or not(expected @> p_ids and p_ids @> expected) or total<>p_expected_total then raise exception 'Family total changed. Refresh and check in everyone before voiding'; end if;
  if exists(select 1 from admission_pos_sales where status='open' and checkin_ids && p_ids) then raise exception 'Reconcile the pending Square checkout before voiding admission'; end if;
  if exists(select 1 from open_play_reservations r join open_play_reservation_slots s on s.id=r.slot_id
      where r.household_id=p_family and r.child_ids && visitors and r.status<>'cancelled'
        and (s.starts_at at time zone 'America/New_York')::date=today
        and coalesce(r.payment_environment,'production')=p_environment and (r.payment_status='paid' or r.square_order_id is not null)) then
    raise exception 'This visit has an online payment or checkout. Verify its Square receipt before voiding';
  end if;
  insert into admission_payment_voids(id,household_id,actor_id,environment,visit_date,checkin_ids,reason,original_amount_cents,before_records)
    values(p_id,p_family,p_actor,p_environment,today,p_ids,trim(p_reason),total,before_rows);
  update checkins set price_cents=0,payment_status='covered',
    notes=concat_ws(E'\n',nullif(notes,''),'[Admission payment voided: '||p_id::text||'] '||trim(p_reason)||' · staff '||p_actor::text)
    where id=any(p_ids);
  return jsonb_build_object('voided',true,'amount_cents',0,'voided_cents',total,'already_voided',false);
end $$;
revoke all on function public.void_admission_payment(uuid,uuid,uuid,uuid[],text,text,integer) from public,anon,authenticated;
grant execute on function public.void_admission_payment(uuid,uuid,uuid,uuid[],text,text,integer) to service_role;
notify pgrst,'reload schema';
commit;
