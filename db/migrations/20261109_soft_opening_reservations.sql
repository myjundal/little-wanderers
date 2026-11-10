begin;
alter table public.open_play_reservations
  add column if not exists child_ids uuid[] not null default '{}',
  add column if not exists payment_choice text not null default 'counter' check(payment_choice in ('counter','now','membership')),
  add column if not exists payment_status text not null default 'due' check(payment_status in ('due','paid','covered','review')),
  add column if not exists amount_cents integer not null default 0 check(amount_cents>=0),
  add column if not exists square_order_id text,
  add column if not exists square_payment_link_id text,
  add column if not exists payment_url text,
  add column if not exists payment_environment text,
  add column if not exists square_payment_ids text[],
  add column if not exists paid_at timestamptz;
create unique index if not exists open_play_square_order on public.open_play_reservations(payment_environment,square_order_id) where square_order_id is not null;
alter table public.open_play_reservation_slots alter column capacity_children set default 5;

-- Keep history. Retire unbooked legacy windows, and stop if a new schedule would overlap existing visits.
do $$ begin
 if exists(select 1 from open_play_reservations r join open_play_reservation_slots s on s.id=r.slot_id
   where r.status='reserved' and s.is_soft_opening and s.starts_at>='2026-11-11 00:00 America/New_York'
     and s.starts_at<'2027-01-01 00:00 America/New_York') then
   raise exception 'Existing future reservations need review before releasing the new schedule.';
 end if;
end $$;
update public.open_play_reservation_slots set status='hidden' where is_soft_opening and starts_at>='2026-11-11 00:00 America/New_York' and starts_at<'2027-01-01 00:00 America/New_York';
insert into public.open_play_reservation_slots(label,starts_at,ends_at,capacity_children,capacity_total,status,notes,is_soft_opening)
select 'Soft Opening Open Play', (day::date + make_time(hour,0,0)) at time zone 'America/New_York',
 (day::date + make_time(hour+1,0,0)) at time zone 'America/New_York',5,null,'open',
 'Approximate arrival window, not a timed session. Aim to arrive within this hour; no need to arrive exactly at the start. Stay until you are ready to leave, up to closing.',true
from generate_series(date '2026-11-11',date '2026-12-31',interval '1 day') days(day)
cross join generate_series(9,16) hours(hour)
where hour < case when day::date<='2026-11-15' then 14 else 17 end
and not exists(select 1 from open_play_reservation_slots s where s.is_soft_opening and s.starts_at=(day::date+make_time(hour,0,0)) at time zone 'America/New_York' and s.ends_at=(day::date+make_time(hour+1,0,0)) at time zone 'America/New_York');
update public.open_play_reservation_slots set status='open',capacity_children=5,capacity_total=null,
 notes='Approximate arrival window, not a timed session. Aim to arrive within this hour; no need to arrive exactly at the start. Stay until you are ready to leave, up to closing.'
where is_soft_opening and starts_at>='2026-11-11 00:00 America/New_York' and starts_at<'2027-01-01 00:00 America/New_York'
 and ends_at=starts_at+interval '1 hour' and extract(minute from starts_at at time zone 'America/New_York')=0
 and extract(hour from starts_at at time zone 'America/New_York') between 9 and case when (starts_at at time zone 'America/New_York')::date<='2026-11-15' then 13 else 16 end;

-- Preserve the installed capacity locking; only a future reserved visit blocks a second booking.
do $$ declare definition text; begin
 definition:=pg_get_functiondef('public.guard_open_play_reservation_capacity()'::regprocedure);
 definition:=replace(definition,$old$r.status <> 'cancelled'$old$,$new$r.status = 'reserved' and s.ends_at > now()$new$);
 if position('s.ends_at > now()' in definition)=0 then raise exception 'Capacity guard needs review before release';end if;
 execute definition;
end $$;

create or replace function public.fulfill_open_play_reservation(p_id uuid,p_order text,p_payments text[],p_amount integer)
returns public.open_play_reservations language plpgsql security definer set search_path=public as $$
declare r open_play_reservations;
begin
 select * into strict r from open_play_reservations where id=p_id for update;
 if r.square_order_id is distinct from p_order or r.amount_cents<>p_amount or r.payment_choice<>'now' or cardinality(p_payments)<1 then raise exception 'Payment does not match reservation';end if;
 if r.payment_status='paid' then return r;end if;
 if r.status='cancelled' then raise exception 'Canceled reservation payment needs owner review';end if;
 update open_play_reservations set payment_status='paid',square_payment_ids=p_payments,paid_at=now() where id=p_id returning * into r;
 return r;
end $$;
revoke all on function public.fulfill_open_play_reservation(uuid,text,text[],integer) from public,anon,authenticated;
grant execute on function public.fulfill_open_play_reservation(uuid,text,text[],integer) to service_role;

-- The original check-in retains its waiver, membership, paid-pass and occupancy logic.
-- Apply each named child's prepaid admission to the reserved calendar date only.
create or replace function public.apply_open_play_reservation_payment(p_checkin uuid)
returns void language plpgsql security definer set search_path=public as $$
declare c checkins; r open_play_reservations; child_role text;
begin
 select * into strict c from checkins where id=p_checkin for update;
 select role into child_role from people where id=c.person_id;
 if child_role<>'child' or coalesce(c.square_environment,'production')<>'production' then return;end if;
 select res.* into r from open_play_reservations res join open_play_reservation_slots s on s.id=res.slot_id
 where res.household_id=c.household_id and c.person_id=any(res.child_ids) and res.status in ('reserved','checked_in')
 and (s.starts_at at time zone 'America/New_York')::date=(c.checked_in_at at time zone 'America/New_York')::date
 limit 1 for update of res;
 if not found then return;end if;
 if r.payment_status='paid' and r.payment_environment='production' then
   update checkins set price_cents=0,payment_status='prepaid',square_order_id=r.square_order_id,square_environment=r.payment_environment where id=p_checkin;
 elsif r.payment_status='due' and c.price_cents>0 then
   update checkins set price_cents=case when exists(
     select 1 from checkins prior where prior.household_id=c.household_id and prior.person_id=any(r.child_ids)
       and prior.id<>c.id and prior.price_cents>0
       and (prior.checked_in_at at time zone 'America/New_York')::date=(c.checked_in_at at time zone 'America/New_York')::date
   ) then 1000 else 1600 end where id=p_checkin;
 end if;
end $$;
revoke all on function public.apply_open_play_reservation_payment(uuid) from public,anon,authenticated;
-- Trigger after original check-in has created its row: no additional check-in overloads.
create or replace function public.apply_open_play_prepaid_checkin_trigger()
returns trigger language plpgsql security definer set search_path=public as $$
begin perform public.apply_open_play_reservation_payment(new.id); return new;end $$;
drop trigger if exists apply_open_play_prepaid_checkin on public.checkins;
create trigger apply_open_play_prepaid_checkin after insert on public.checkins for each row execute function public.apply_open_play_prepaid_checkin_trigger();
revoke all on function public.apply_open_play_prepaid_checkin_trigger() from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
