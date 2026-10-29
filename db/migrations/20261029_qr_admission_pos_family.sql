-- The Square payment tables/functions were already applied to Production on 2026-10-29.
-- This focused release does not enable the customer online checkout flows.
begin;
create or replace function public.prepare_admission_pos(p_ids uuid[],p_user uuid,p_environment text,p_location text)
returns public.admission_pos_sales language plpgsql security definer set search_path=public as $$
declare sale admission_pos_sales; total integer; family uuid;
begin
  perform pg_advisory_xact_lock(hashtext('little-wanderers-admission-pos'));
  if cardinality(p_ids) not between 1 and 30 or cardinality(p_ids)<>(select count(distinct x) from unnest(p_ids) x) then raise exception 'Choose unpaid check-ins'; end if;
  select min(p.household_id::text)::uuid into family from checkins c join people p on p.id=c.person_id where c.id=any(p_ids);
  if family is null or (select count(distinct p.household_id) from checkins c join people p on p.id=c.person_id where c.id=any(p_ids))<>1 then
    raise exception 'Choose exactly one visiting family';
  end if;
  perform 1 from households where id=family for update;
  perform 1 from checkins where id=any(p_ids) for update;
  if (select count(*) from checkins where id=any(p_ids) and payment_status='due' and price_cents>0 and (checked_in_at at time zone 'America/New_York')::date=(now() at time zone 'America/New_York')::date)<>cardinality(p_ids) then raise exception 'Check-in amount changed; refresh first'; end if;
  if (select count(*) from checkins c join people p on p.id=c.person_id where p.household_id=family
      and c.payment_status='due' and c.price_cents>0
      and (c.checked_in_at at time zone 'America/New_York')::date=(now() at time zone 'America/New_York')::date)<>cardinality(p_ids) then
    raise exception 'Family admission changed; refresh and finish scanning before payment';
  end if;
  select * into sale from admission_pos_sales where environment=p_environment and status='open' and checkin_ids && p_ids limit 1;
  if found then
    if sale.checkin_ids @> p_ids and p_ids @> sale.checkin_ids and sale.created_by_user_id=p_user then return sale; end if;
    raise exception 'A Square payment is already in progress for these check-ins';
  end if;
  select sum(price_cents) into total from checkins where id=any(p_ids);
  insert into admission_pos_sales(environment,location_id,created_by_user_id,checkin_ids,amount_cents) values(p_environment,p_location,p_user,p_ids,total) returning * into sale;
  return sale;
end $$;

revoke all on function public.prepare_admission_pos(uuid[],uuid,text,text) from public,anon,authenticated;
grant execute on function public.prepare_admission_pos(uuid[],uuid,text,text) to service_role;

-- Recovery is an explicit staff reconciliation, never an automatic second charge.
alter table public.admission_pos_sales add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by_user_id uuid;
create or replace function public.cancel_admission_pos_after_review(p_id uuid,p_user uuid)
returns void language plpgsql security definer set search_path=public as $$
declare sale admission_pos_sales;
begin
  perform pg_advisory_xact_lock(hashtext('little-wanderers-admission-pos'));
  select * into strict sale from admission_pos_sales where id=p_id for update;
  if sale.created_by_user_id is distinct from p_user then raise exception 'POS sale belongs to another operator'; end if;
  if sale.status='cancelled' then return; end if;
  if sale.status<>'open' or sale.launched_at is null or sale.launched_at>now()-interval '60 seconds' then raise exception 'Check Square and wait one minute before resetting this checkout'; end if;
  if exists(select 1 from checkins where id=any(sale.checkin_ids) and payment_status<>'due') then raise exception 'Admission payment changed; refresh first'; end if;
  update admission_pos_sales set status='cancelled',cancelled_at=now(),cancelled_by_user_id=p_user where id=p_id;
end $$;
revoke all on function public.cancel_admission_pos_after_review(uuid,uuid) from public,anon,authenticated;
grant execute on function public.cancel_admission_pos_after_review(uuid,uuid) to service_role;
notify pgrst,'reload schema';
commit;
