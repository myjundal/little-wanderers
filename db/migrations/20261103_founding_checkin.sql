begin;

-- Production enrollments cover the enrolled children only. A saved card is not
-- proof of payment: pre-opening access requires an actual soft-opening reservation.
create or replace function public.founding_covers_person(p_person uuid,p_household uuid,p_date date)
returns boolean language sql stable security definer set search_path=public as $$
  select exists (
    select 1 from founding_memberships f
    where f.household_id=p_household and f.environment='production' and p_person=any(f.child_ids)
      and (
        (f.status in ('active','canceled','canceling') and f.start_date<=p_date and f.paid_through>=p_date)
        or (f.status in ('pending','activating','scheduled','active') and exists (
          select 1 from open_play_reservations r join open_play_reservation_slots s on s.id=r.slot_id
          where r.household_id=p_household and r.status in ('reserved','checked_in') and s.is_soft_opening
            and (s.starts_at at time zone 'America/New_York')::date=p_date
        ))
      )
  );
$$;
revoke all on function public.founding_covers_person(uuid,uuid,date) from public,anon,authenticated;
grant execute on function public.founding_covers_person(uuid,uuid,date) to service_role;

-- Patch the installed function in place, including its current signature and
-- paid-pass, environment, waiver and occupancy checks. Do not add an overload.
do $patch$
declare installed record; definition text; date_variable text; environment_guard text; patched integer:=0;
begin
  for installed in select p.oid,p.proargnames from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='checkin_person' loop
    definition:=pg_get_functiondef(installed.oid);
    if position('founding_covers_person' in definition)>0 then patched:=patched+1;continue;end if;
    if array_length(string_to_array(definition,'into member;'),1)<>2 then raise exception 'Unrecognized check-in membership check; no changes applied.';end if;
    date_variable:=case when definition ~ 'today_date[[:space:]]+date' then 'today_date' when definition ~ 'visit_date[[:space:]]+date' then 'visit_date' end;
    if date_variable is null then raise exception 'Unrecognized check-in visit date; no changes applied.';end if;
    environment_guard:=case when 'p_environment'=any(installed.proargnames) then 'p_environment=''production'' and ' else '' end;
    definition:=replace(definition,'into member;',format('into member; member:=member or (%spublic.founding_covers_person(person.id,person.household_id,%s));',environment_guard,date_variable));
    execute definition;
    patched:=patched+1;
  end loop;
  if patched<>1 then raise exception 'Expected exactly one installed check-in function; no changes applied.';end if;
end;
$patch$;

notify pgrst, 'reload schema';
commit;
