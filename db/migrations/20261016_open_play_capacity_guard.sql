begin;

-- Serialize new/restored reservations so simultaneous requests cannot overbook.
-- Existing reservations are preserved; no backfill or status changes are made.
create or replace function public.guard_open_play_reservation_capacity()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  target public.open_play_reservation_slots%rowtype;
  children_used bigint;
  people_used bigint;
begin
  if new.status = 'cancelled' then return new; end if;
  if tg_op = 'UPDATE' then
    if old.status <> 'cancelled' and new.slot_id = old.slot_id
      and new.household_id = old.household_id
      and new.child_count <= old.child_count and new.adult_count <= old.adult_count then
      return new;
    end if;
  end if;

  -- One soft-opening visit per household, even when requests choose different slots.
  perform pg_advisory_xact_lock(hashtextextended('open-play-household:' || new.household_id::text, 0));
  select * into target from public.open_play_reservation_slots where id = new.slot_id for update;
  if not found then raise exception 'Visit time not found.' using errcode = '23503'; end if;
  if target.status <> 'open' or target.ends_at <= now() then
    raise exception 'This visit time is not open for reservations.' using errcode = '23514';
  end if;
  if target.is_soft_opening and exists (
    select 1 from public.open_play_reservations r
    join public.open_play_reservation_slots s on s.id = r.slot_id
    where r.household_id = new.household_id and r.status <> 'cancelled'
      and r.id <> new.id and s.is_soft_opening
  ) then
    raise exception 'You already have a soft opening reservation.' using errcode = '23505';
  end if;
  select coalesce(sum(child_count),0), coalesce(sum(child_count + adult_count),0)
  into children_used, people_used from public.open_play_reservations
  where slot_id = new.slot_id and status <> 'cancelled' and id <> new.id;
  if children_used + new.child_count > target.capacity_children
    or (target.capacity_total is not null and people_used + new.child_count + new.adult_count > target.capacity_total) then
    raise exception 'This visit time is full. Please choose another time.' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_open_play_reservation_capacity() from public, anon, authenticated;
drop trigger if exists guard_open_play_reservation_capacity on public.open_play_reservations;
create trigger guard_open_play_reservation_capacity
before insert or update of slot_id, household_id, child_count, adult_count, status
on public.open_play_reservations for each row execute function public.guard_open_play_reservation_capacity();

commit;
