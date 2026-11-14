begin;

create table public.staff_admission_actions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id),
  actor_id uuid not null references auth.users(id),
  kind text not null check (kind in ('receipt_link','waiver_link')),
  resource_id text not null,
  details jsonb not null,
  created_at timestamptz not null default now(),
  unique(kind,resource_id)
);
create table public.staff_admission_cases (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id),
  visit_date date not null,
  category text not null check (category in ('payment','waiver','other')),
  note text not null check (length(trim(note)) between 5 and 1500),
  status text not null default 'open' check (status in ('open','resolved')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  resolved_by uuid references auth.users(id),
  resolved_at timestamptz,
  resolution text,
  check ((status='open' and resolved_at is null and resolved_by is null) or
    (status='resolved' and resolved_at is not null and resolved_by is not null and length(trim(resolution))>=5))
);
create index staff_admission_cases_open on public.staff_admission_cases(created_at) where status='open';
alter table public.staff_admission_actions enable row level security;
alter table public.staff_admission_cases enable row level security;
revoke all on public.staff_admission_actions, public.staff_admission_cases from public,anon,authenticated;
grant all on public.staff_admission_actions, public.staff_admission_cases to service_role;

create function public.staff_link_admission_receipt(p_actor uuid,p_family uuid,p_day date,p_ids uuid[],p_environment text,p_order text,p_proof jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare prior staff_admission_actions; total integer; old_rows jsonb; expected uuid[];
begin
  if not exists(select 1 from roles where id=p_actor and role in ('owner','admin','staff'))
    and not exists(select 1 from user_roles where user_id=p_actor and role in ('owner','admin','staff')) then raise exception 'Staff access required'; end if;
  if coalesce(p_environment,'') not in ('production','sandbox') or coalesce(length(p_order),0) not between 1 and 200
    or p_day is null or p_day>(now() at time zone 'America/New_York')::date
    or coalesce(jsonb_typeof(p_proof),'')<>'object'
    or coalesce(p_proof->>'admission_cents','')!~'^[1-9][0-9]{0,8}$'
    or coalesce(p_proof->>'paid_cents','')!~'^[1-9][0-9]{0,8}$' then raise exception 'Invalid receipt'; end if;
  perform pg_advisory_xact_lock(hashtext('little-wanderers-admission-pos'));
  perform pg_advisory_xact_lock(hashtext('staff-receipt:'||p_environment||':'||p_order));
  select * into prior from staff_admission_actions where kind='receipt_link' and resource_id=p_environment||':'||p_order;
  if found then
    if prior.household_id<>p_family or prior.details->>'visit_date' is distinct from p_day::text
      or p_ids is null or not ((select array_agg((v->>'id')::uuid) from jsonb_array_elements(prior.details->'before') v) @> p_ids
        and p_ids @> (select array_agg((v->>'id')::uuid) from jsonb_array_elements(prior.details->'before') v)) then raise exception 'This receipt is already linked to another family or visit'; end if;
    return jsonb_build_object('status','paid','already_linked',true);
  end if;
  if p_ids is null or cardinality(p_ids) not between 1 and 30 or cardinality(p_ids)<>(select count(distinct id) from unnest(p_ids) id) then raise exception 'Choose the family unpaid visits'; end if;
  perform 1 from households where id=p_family for update;
  perform 1 from checkins where household_id=p_family and (checked_in_at at time zone 'America/New_York')::date=p_day for update;
  select array_agg(id order by id),sum(price_cents),jsonb_agg(to_jsonb(c)) into expected,total,old_rows
    from checkins c where household_id=p_family and (checked_in_at at time zone 'America/New_York')::date=p_day
      and payment_status in ('due','paid','walkin_paid','terminal_paid') and square_order_id is null
      and (square_environment is null or square_environment=p_environment) and price_cents>0;
  if expected is null or not(expected @> p_ids and p_ids @> expected) or total<>(p_proof->>'admission_cents')::integer then raise exception 'Admission changed. Refresh and check the receipt again'; end if;
  if exists(select 1 from admission_pos_sales where status='open' and checkin_ids && p_ids) then raise exception 'Reconcile the pending Square checkout before linking a separate receipt'; end if;
  if exists(select 1 from checkins where square_order_id=p_order and coalesce(square_environment,'production')=p_environment and not(id=any(p_ids)))
    or exists(select 1 from admission_pos_sales where order_id=p_order and environment=p_environment)
    or exists(select 1 from square_checkout_attempts where order_id=p_order and environment=p_environment)
    or exists(select 1 from open_play_reservations where square_order_id=p_order and payment_environment=p_environment)
    or exists(select 1 from party_bookings where square_order_id=p_order and square_environment=p_environment)
    or exists(select 1 from class_series_sales where square_order_id=p_order and environment=p_environment) then raise exception 'Receipt already belongs to another booking or payment'; end if;
  if not exists(select 1 from square_payment_receipts where environment=p_environment and order_id=p_order)
    or exists(select 1 from square_payment_receipts where environment=p_environment and order_id=p_order and (status<>'COMPLETED' or refunded_cents<>0))
    or (select sum(amount_cents) from square_payment_receipts where environment=p_environment and order_id=p_order)<>(p_proof->>'paid_cents')::integer
    or (p_proof->>'paid_cents')::integer<total then raise exception 'A completed, unrefunded Square receipt is required'; end if;
  insert into staff_admission_actions(household_id,actor_id,kind,resource_id,details)
    values(p_family,p_actor,'receipt_link',p_environment||':'||p_order,jsonb_build_object('before',old_rows,'receipt',p_proof,'visit_date',p_day));
  update checkins set payment_status='paid',square_order_id=p_order,square_environment=p_environment,payment_recorded_at=now()
    where id=any(p_ids);
  update staff_admission_cases set status='resolved',resolved_by=p_actor,resolved_at=now(),resolution='Completed Square receipt verified and linked to this visit.'
    where household_id=p_family and visit_date=p_day and category='payment' and status='open';
  return jsonb_build_object('status','paid','amount_cents',total);
end $$;

create function public.staff_link_admission_waiver(p_actor uuid,p_family uuid,p_waiver uuid,p_mapping jsonb,p_reason text,p_version text,p_guardian_confirmed boolean)
returns jsonb language plpgsql security definer set search_path=public as $$
declare w waivers; source_family uuid; target_ids uuid[]; source_ids uuid[]; old_people jsonb; item jsonb; from_child people; to_child people; audit jsonb;
begin
  if not exists(select 1 from roles where id=p_actor and role in ('owner','admin','staff'))
    and not exists(select 1 from user_roles where user_id=p_actor and role in ('owner','admin','staff')) then raise exception 'Staff access required'; end if;
  if p_guardian_confirmed is distinct from true or coalesce(length(trim(p_reason)),0) not between 10 and 1000 then raise exception 'Confirm the family with the guardian and enter a reason'; end if;
  perform pg_advisory_xact_lock(hashtext('staff-waiver:'||p_waiver::text));
  select * into strict w from waivers where id=p_waiver for update;
  if w.household_id=p_family and w.agreement_snapshot->'family_reconciliation'->>'match_basis'='staff_confirmed' then
    if exists(select 1 from people where household_id=p_family and role='child' and not(id=any(coalesce(w.covered_person_ids,'{}')))) then raise exception 'Family children changed. Ask the guardian to complete an updated waiver'; end if;
    return jsonb_build_object('status','linked','already_linked',true);
  end if;
  source_family:=w.household_id;
  if source_family=p_family then raise exception 'This waiver is already on the selected family'; end if;
  perform 1 from households where id in (source_family,p_family) order by id for update;
  if w.source<>'guest_website' or w.signed_by_user_id is not null or w.waiver_version is distinct from p_version
    or w.signed_at>now() or w.signed_at is null or w.waiver_expires_at<=now() or w.waiver_expires_at is null
    or coalesce(length(trim(w.electronic_signature)),0)<2 then raise exception 'Choose a current signed guest waiver'; end if;
  if exists(select 1 from staff_family_search_aliases where alias_household_id in (source_family,p_family) or canonical_household_id=source_family) then raise exception 'This family is already linked. Reopen its current family record'; end if;
  if exists(select 1 from household_members where household_id=source_family)
    or exists(select 1 from memberships where household_id=source_family)
    or exists(select 1 from party_bookings where household_id=source_family)
    or exists(select 1 from open_play_reservations where household_id=source_family)
    or exists(select 1 from class_series_sales where household_id=source_family)
    or exists(select 1 from founding_memberships where household_id=source_family)
    or exists(select 1 from guest_waiver_identities where household_id=source_family)
    or exists(select 1 from checkins where household_id=source_family or person_id in(select id from people where household_id=source_family))
    or exists(select 1 from class_registrations where person_id in(select id from people where household_id=source_family)) then raise exception 'This signed family has account or visit history. Save for owner review'; end if;
  if coalesce(jsonb_typeof(p_mapping),'')<>'array' or jsonb_array_length(p_mapping) not between 1 and 20 then raise exception 'Match each signed child'; end if;
  select array_agg((v->>'source_id')::uuid),array_agg((v->>'target_id')::uuid) into source_ids,target_ids from jsonb_array_elements(p_mapping) v;
  if array_position(source_ids,null) is not null or array_position(target_ids,null) is not null
    or cardinality(source_ids)<>(select count(distinct id) from unnest(source_ids) id)
    or cardinality(target_ids)<>(select count(distinct id) from unnest(target_ids) id)
    or not(coalesce(w.covered_person_ids,'{}') @> source_ids and source_ids @> coalesce(w.covered_person_ids,'{}'))
    or cardinality(target_ids)<>(select count(*) from people where household_id=p_family and role='child') then raise exception 'Match every signed child to each child in this family once'; end if;
  select jsonb_agg(to_jsonb(p)) into old_people from people p where id=any(target_ids);
  for item in select * from jsonb_array_elements(p_mapping) loop
    select * into strict from_child from people where id=(item->>'source_id')::uuid and household_id=source_family and role='child';
    select * into strict to_child from people where id=(item->>'target_id')::uuid and household_id=p_family and role='child' for update;
    if not exists(select 1 from jsonb_array_elements(w.agreement_snapshot->'children') c where c->>'id'=from_child.id::text
      and c->>'first_name'=from_child.first_name and (c->>'birthdate')::date=from_child.birthdate)
      or from_child.birthdate is null or from_child.birthdate>(now() at time zone 'America/New_York')::date then raise exception 'Signed child evidence needs owner review'; end if;
    update people set birthdate=from_child.birthdate where id=to_child.id and birthdate is null;
  end loop;
  audit:=jsonb_build_object('source_household_id',source_family,'target_household_id',p_family,'original_covered_person_ids',w.covered_person_ids,
    'person_ids',(select jsonb_object_agg(v->>'source_id',v->>'target_id') from jsonb_array_elements(p_mapping) v),
    'linked_at',now(),'match_basis','staff_confirmed','actor_id',p_actor,'guardian_confirmed',true,'reason',trim(p_reason));
  insert into staff_admission_actions(household_id,actor_id,kind,resource_id,details)
    values(p_family,p_actor,'waiver_link',w.id::text,jsonb_build_object('before_household_id',source_family,'before_covered_person_ids',w.covered_person_ids,'before_people',old_people,'review',audit));
  update waivers set household_id=p_family,covered_person_ids=target_ids,agreement_snapshot=w.agreement_snapshot||jsonb_build_object('family_reconciliation',audit) where id=w.id;
  update party_guest_waivers set household_id=p_family where waiver_id=w.id;
  update staff_admission_cases set status='resolved',resolved_by=p_actor,resolved_at=now(),resolution='Guardian and each child confirmed; signed waiver linked to this family.'
    where household_id=p_family and category='waiver' and visit_date=(now() at time zone 'America/New_York')::date and status='open';
  if not exists(select 1 from waivers where household_id=source_family) then
    insert into staff_family_search_aliases(alias_household_id,canonical_household_id,reason)
      values(source_family,p_family,'Staff confirmed the signed guardian and each child in person. Original signature and child snapshot retained.');
  end if;
  return jsonb_build_object('status','linked');
end $$;
revoke all on function public.staff_link_admission_receipt(uuid,uuid,date,uuid[],text,text,jsonb) from public,anon,authenticated;
revoke all on function public.staff_link_admission_waiver(uuid,uuid,uuid,jsonb,text,text,boolean) from public,anon,authenticated;
grant execute on function public.staff_link_admission_receipt(uuid,uuid,date,uuid[],text,text,jsonb) to service_role;
grant execute on function public.staff_link_admission_waiver(uuid,uuid,uuid,jsonb,text,text,boolean) to service_role;
notify pgrst,'reload schema';
commit;
