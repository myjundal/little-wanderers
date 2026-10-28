begin;
alter table public.checkins
  add column if not exists household_id uuid references public.households(id) on delete set null,
  add column if not exists child_id uuid references public.people(id) on delete set null,
  add column if not exists created_by_user_id uuid references auth.users(id) on delete set null,
  add column if not exists created_by_role text;
create index if not exists idx_checkins_household_id on public.checkins(household_id);

create or replace function public.open_play_total_cents(p_birthdates date[], p_adults integer, p_visit_date date)
returns integer language sql immutable set search_path = public as $$
  select case when cardinality(p_birthdates) > 0 then
    (case when exists (select 1 from unnest(p_birthdates) b where b + interval '6 months' < p_visit_date) then 1600 else 1000 end)
      + greatest(cardinality(p_birthdates) - 1, 0) * 1000
    else 0 end + greatest(p_adults - 2, 0) * 500;
$$;
revoke all on function public.open_play_total_cents(date[], integer, date) from public, anon, authenticated;
grant execute on function public.open_play_total_cents(date[], integer, date) to service_role;

-- Serialize a family's scans: check-in, sibling pricing and occupancy commit together.
create or replace function public.checkin_person(p_person_id uuid, p_staff_user_id uuid, p_staff_role text, p_source text, p_waiver_version text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  person public.people%rowtype;
  visit_date date := (now() at time zone 'America/New_York')::date;
  prior_birthdates date[];
  next_birthdates date[];
  prior_adults integer;
  amount integer;
  member boolean;
  checkin_id uuid;
begin
  if not exists (select 1 from public.roles where id=p_staff_user_id and role in ('staff','owner','admin'))
    and not exists (select 1 from public.user_roles where user_id=p_staff_user_id and role in ('staff','owner','admin')) then
    return jsonb_build_object('ok',false,'error','Staff access required.','code','forbidden');
  end if;
  select * into person from public.people where id=p_person_id;
  if not found then return jsonb_build_object('ok',false,'error','Person not found.','code','not_found'); end if;
  perform 1 from public.households where id=person.household_id for update;
  if exists (select 1 from public.checkins where person_id=p_person_id and (checked_in_at at time zone 'America/New_York')::date=visit_date) then
    return jsonb_build_object('ok',false,'error','Already checked in today.','code','already_checked_in');
  end if;
  if not exists (
    select 1 from public.waivers w where w.household_id=person.household_id
    and w.waiver_version=p_waiver_version and w.signed_at <= now() and w.waiver_expires_at > now()
    and length(trim(w.electronic_signature)) >= 2
    and not exists (select 1 from public.people child where child.household_id=person.household_id and child.role='child' and not (child.id=any(coalesce(w.covered_person_ids,'{}'::uuid[]))))
  ) then return jsonb_build_object('ok',false,'error','A parent or legal guardian must complete the family waiver before check-in.','code','waiver_required'); end if;
  if person.role='child' and (person.birthdate is null or person.birthdate > visit_date) then
    return jsonb_build_object('ok',false,'error','Add a valid birthday in My Info/People before check-in.','code','birthday_required');
  end if;
  select coalesce(array_agg(p.birthdate) filter(where p.role='child'),'{}'::date[]), count(*) filter(where p.role='adult')
    into prior_birthdates,prior_adults from public.checkins c join public.people p on p.id=c.person_id
    where p.household_id=person.household_id and (c.checked_in_at at time zone 'America/New_York')::date=visit_date;
  select exists(select 1 from public.memberships m where (m.household_id=person.household_id or m.person_id=person.id) and (m.renews_at is null or m.renews_at > now())) into member;
  next_birthdates := case when person.role='child' then array_append(prior_birthdates,person.birthdate) else prior_birthdates end;
  amount := public.open_play_total_cents(next_birthdates,prior_adults + case when person.role='adult' then 1 else 0 end,visit_date)
    - public.open_play_total_cents(prior_birthdates,prior_adults,visit_date);
  if member and person.role='child' then amount:=0; end if;
  insert into public.checkins(person_id,household_id,child_id,created_by_user_id,created_by_role,source,price_cents,membership_applied)
    values(person.id,person.household_id,case when person.role='child' then person.id end,p_staff_user_id,p_staff_role,p_source,amount,member)
    returning id into checkin_id;
  insert into public.occupancy_events(event_type,delta,created_by) values('checkin_increment',1,p_staff_user_id);
  return jsonb_build_object('ok',true,'checkin_id',checkin_id,'membership_applied',member,'price_cents',amount,'first_name',person.first_name,'last_name',person.last_name,'birthdate',person.birthdate,'birthday',person.birthdate);
end;
$$;
revoke all on function public.checkin_person(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.checkin_person(uuid, uuid, text, text, text) to service_role;

-- Existing occupancy API calls use the service role after staff authorization.
do $$ declare f record; begin
  for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('record_checkin','record_manual_increment','record_manual_decrement','reset_occupancy','add_occupancy_event')
  loop
    execute format('revoke all on function %s from public, anon, authenticated',f.signature);
    execute format('grant execute on function %s to service_role',f.signature);
  end loop;
end $$;
notify pgrst, 'reload schema';
commit;
