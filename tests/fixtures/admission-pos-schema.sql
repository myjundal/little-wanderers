-- Minimal isolated fixture for the Square schema already installed in Production.
create role anon; create role authenticated; create role service_role;
create table households(id uuid primary key,name text);
create table people(id uuid primary key,household_id uuid,first_name text,last_name text);
create table checkins(id uuid primary key,person_id uuid,price_cents integer,payment_status text,checked_in_at timestamptz default now(),square_order_id text,square_environment text);
create table admission_pos_sales(id uuid primary key default gen_random_uuid(),environment text,location_id text,created_by_user_id uuid,launched_at timestamptz,checkin_ids uuid[],amount_cents integer,status text default 'open',order_id text,created_at timestamptz default now(),unique(environment,order_id));
create table square_checkout_attempts(environment text,order_id text);
create table square_payment_receipts(environment text,payment_id text,order_id text,amount_cents integer,refunded_cents integer,status text,provider_updated_at timestamptz,updated_at timestamptz default now(),unique(environment,payment_id));
create or replace function public.save_square_payment_receipt(
  p_environment text,p_payment text,p_order text,p_amount integer,p_refunded integer,p_status text,p_updated timestamptz
) returns void language plpgsql security definer set search_path = public as $$
begin
  if p_amount <= 0 or p_refunded < 0 or p_refunded > p_amount or p_updated is null then raise exception 'Invalid payment receipt'; end if;
  if exists(select 1 from square_payment_receipts where environment=p_environment and payment_id=p_payment and order_id<>p_order) then
    raise exception 'Payment order mismatch';
  end if;
  insert into square_payment_receipts(environment,payment_id,order_id,amount_cents,refunded_cents,status,provider_updated_at)
    values(p_environment,p_payment,p_order,p_amount,p_refunded,p_status,p_updated)
  on conflict(environment,payment_id) do update set amount_cents=excluded.amount_cents,refunded_cents=greatest(square_payment_receipts.refunded_cents,excluded.refunded_cents),
    status=excluded.status,provider_updated_at=excluded.provider_updated_at,updated_at=now()
    where excluded.provider_updated_at >= square_payment_receipts.provider_updated_at;
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
