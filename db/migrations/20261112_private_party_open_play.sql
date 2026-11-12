begin;

alter table public.party_bookings add column if not exists is_private boolean not null default false;
create index if not exists party_bookings_private_date on public.party_bookings (start_time)
  where is_private and status <> 'cancelled';

-- Derived availability never changes the owner's manual slot status.
create or replace function public.private_party_blocks_open_play(p_start timestamptz, p_end timestamptz)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.party_bookings p where p.is_private and p.status <> 'cancelled'
      and p_start < (((p.start_time at time zone 'America/New_York')::date + time '18:00') at time zone 'America/New_York')
      and p_end > (((p.start_time at time zone 'America/New_York')::date + time '16:00') at time zone 'America/New_York')
  );
$$;
revoke all on function public.private_party_blocks_open_play(timestamptz,timestamptz) from public, anon, authenticated;
grant execute on function public.private_party_blocks_open_play(timestamptz,timestamptz) to service_role;

create or replace function public.lock_private_party_day(p_day date)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('private-party-open-play:' || p_day::text, 0));
end;
$$;
revoke all on function public.lock_private_party_day(date) from public, anon, authenticated;

create or replace function public.guard_party_private_setting()
returns trigger language plpgsql security definer set search_path = public as $$
declare old_day date; new_day date; request_role text;
begin
  request_role := coalesce(nullif(current_setting('request.jwt.claim.role',true),''),
    nullif(current_setting('request.jwt.claims',true),'')::jsonb ->> 'role', current_setting('role',true));
  if request_role in ('anon','authenticated') and
    ((tg_op='INSERT' and new.is_private) or (tg_op='UPDATE' and (new.is_private is distinct from old.is_private or
      ((old.is_private or new.is_private) and (new.start_time is distinct from old.start_time or new.status is distinct from old.status))))) then
    raise exception 'Only an authorized operator may change private party settings.' using errcode='42501';
  end if;
  if tg_op='UPDATE' and old.is_private then old_day := (old.start_time at time zone 'America/New_York')::date; end if;
  if new.is_private then new_day := (new.start_time at time zone 'America/New_York')::date; end if;
  -- Sorted date locks also serialize moves between two dates without deadlocking.
  if old_day is not null and new_day is not null and old_day > new_day then
    perform public.lock_private_party_day(new_day); perform public.lock_private_party_day(old_day);
  else
    if old_day is not null then perform public.lock_private_party_day(old_day); end if;
    if new_day is not null and new_day is distinct from old_day then perform public.lock_private_party_day(new_day); end if;
  end if;
  return new;
end;
$$;
revoke all on function public.guard_party_private_setting() from public, anon, authenticated;
drop trigger if exists guard_party_private_setting on public.party_bookings;
create trigger guard_party_private_setting before insert or update of is_private,start_time,status
  on public.party_bookings for each row execute function public.guard_party_private_setting();

create or replace function public.guard_open_play_private_party()
returns trigger language plpgsql security definer set search_path = public as $$
declare visit_start timestamptz; visit_end timestamptz; visit_day date; last_day date;
begin
  if new.status='cancelled' then return new; end if;
  if tg_op='UPDATE' then
    if old.status<>'cancelled' and new.slot_id=old.slot_id
      and new.child_count<=old.child_count and new.adult_count<=old.adult_count then return new; end if;
  end if;
  select starts_at,ends_at into visit_start,visit_end from public.open_play_reservation_slots where id=new.slot_id;
  if not found then return new; end if; -- Existing FK/capacity guard reports the missing slot.
  visit_day := (visit_start at time zone 'America/New_York')::date;
  last_day := (visit_end at time zone 'America/New_York')::date;
  while visit_day<=last_day loop
    perform public.lock_private_party_day(visit_day); visit_day := visit_day+1;
  end loop;
  if public.private_party_blocks_open_play(visit_start,visit_end) then
    raise exception 'Open Play is unavailable from 4–6 PM for a private party. Please choose another arrival window.' using errcode='23514';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_open_play_private_party() from public, anon, authenticated;
-- Run before the existing household/slot capacity locks.
drop trigger if exists a_guard_open_play_private_party on public.open_play_reservations;
create trigger a_guard_open_play_private_party before insert or update of slot_id,household_id,child_count,adult_count,status
  on public.open_play_reservations for each row execute function public.guard_open_play_private_party();

notify pgrst,'reload schema';
commit;
