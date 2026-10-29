begin;
alter table public.square_checkout_attempts add column hold_expires_at timestamptz not null default now()+interval '30 minutes';
create index square_checkout_expired_holds on public.square_checkout_attempts(environment,hold_expires_at)
  where kind in ('class','admission') and status in ('creating','open');
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
revoke all on function public.abandon_uncreated_square_checkout(uuid) from public,anon,authenticated;
grant execute on function public.abandon_uncreated_square_checkout(uuid) to service_role;
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
notify pgrst,'reload schema';
commit;
