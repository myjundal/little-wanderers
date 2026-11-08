begin;
create table public.class_series_programs (
  id text primary key, title text not null, class_ids uuid[] not null,
  price_cents integer not null check(price_cents>0), second_child_discount_cents integer not null default 2000,
  due_at timestamptz not null, payments_enabled boolean not null default false,
  terms_version text not null default '2026-11-08'
);
create table public.class_series_sales (
  id uuid primary key default gen_random_uuid(), program_id text not null references public.class_series_programs(id),
  household_id uuid not null references public.households(id), child_ids uuid[] not null,
  class_ids uuid[] not null, created_by_user_id uuid not null references auth.users(id),
  environment text not null check(environment in ('sandbox','production')), location_id text not null,
  amount_cents integer not null check(amount_cents>0), discount_cents integer not null default 0,
  recipient_email text not null, source text not null check(source in ('invoice','online')),
  status text not null default 'draft' check(status in ('draft','held','paid','cancelled','review')),
  due_at timestamptz not null, hold_until timestamptz, terms_version text not null,
  square_customer_id text, square_order_id text, square_invoice_id text, square_invoice_version integer,
  payment_url text, delivery_method text, sent_at timestamptz, paid_at timestamptz,
  terms_accepted_at timestamptz, terms_accepted_by_user_id uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique(environment,square_order_id), unique(environment,square_invoice_id)
);
create unique index class_series_one_open_family on public.class_series_sales(program_id,household_id,environment) where status in ('draft','held','review');
create table public.class_series_payment_receipts (
  environment text not null, payment_id text not null, sale_id uuid not null references public.class_series_sales(id),
  primary key(environment,payment_id)
);
alter table public.class_series_programs enable row level security;
alter table public.class_series_sales enable row level security;
alter table public.class_series_payment_receipts enable row level security;
revoke all on public.class_series_programs,public.class_series_sales,public.class_series_payment_receipts from public,anon,authenticated;
grant all on public.class_series_programs,public.class_series_sales,public.class_series_payment_receipts to service_role;

insert into public.class_series_programs(id,title,class_ids,price_cents,due_at)
select 'jamie-art-2026-11-12','Little Hands, Big Canvases',array_agg(id order by start_time),15000,'2026-11-11T22:00:00Z'
from public.classes where title='Little Hands, Big Canvases' and status='scheduled'
and start_time=any(array['2026-11-12T22:00:00Z','2026-11-19T22:00:00Z','2026-12-03T22:00:00Z','2026-12-10T22:00:00Z','2026-12-17T22:00:00Z']::timestamptz[])
having count(*)=5;

create function public.prepare_class_series_sale(p_program text,p_family uuid,p_children uuid[],p_user uuid,p_environment text,p_location text,p_source text)
returns public.class_series_sales language plpgsql security definer set search_path=public as $$
declare program class_series_programs; sale class_series_sales; paid_count integer; discount integer; email text;
begin
  perform pg_advisory_xact_lock(hashtextextended('class-series:'||p_program,0));
  select * into strict program from class_series_programs where id=p_program;
  if now()>=program.due_at then raise exception 'Payment deadline has passed'; end if;
  if not exists(select 1 from household_members where household_id=p_family and user_id=p_user)
    and not exists(select 1 from roles where id=p_user and role in ('owner','admin')) then raise exception 'Family access denied'; end if;
  if cardinality(p_children) not between 1 and 7 or cardinality(p_children)<>(select count(distinct x) from unnest(p_children) x)
    or exists(select 1 from unnest(p_children) x where x is null) then raise exception 'Choose distinct children'; end if;
  if (select count(*) from people where id=any(p_children) and household_id=p_family and role='child')<>cardinality(p_children) then raise exception 'Choose children in your family'; end if;
  if (select count(*) from classes where id=any(program.class_ids) and status='scheduled' and price_cents=program.price_cents)<>cardinality(program.class_ids) then raise exception 'Series schedule or price changed; contact us'; end if;
  if exists(select 1 from class_registrations where class_id=any(program.class_ids) and person_id=any(p_children) and status in ('scheduled','attended')) then raise exception 'A selected child already has a confirmed registration'; end if;
  if exists(select 1 from class_series_sales where program_id=p_program and environment=p_environment and status='paid' and child_ids && p_children) then raise exception 'A selected child already paid for this series'; end if;
  select * into sale from class_series_sales where program_id=p_program and environment=p_environment and household_id=p_family and status in ('draft','held','review');
  if found then
    if sale.child_ids @> p_children and p_children @> sale.child_ids and sale.location_id=p_location and sale.status<>'review' then return sale; end if;
    raise exception 'An invoice or checkout already exists for this family. Use the same children or contact us to update it';
  end if;
  select count(distinct child) into paid_count from class_series_sales s cross join lateral unnest(s.child_ids) child
    where s.program_id=p_program and s.environment=p_environment and s.household_id=p_family and s.status='paid';
  discount:=case when paid_count=0 and cardinality(p_children)>=2 or paid_count=1 then least(program.second_child_discount_cents,program.price_cents) else 0 end;
  select h.email into email from households h where h.id=p_family;
  if nullif(trim(email),'') is null then raise exception 'A family email address is required'; end if;
  insert into class_series_sales(program_id,household_id,child_ids,class_ids,created_by_user_id,environment,location_id,amount_cents,discount_cents,recipient_email,source,due_at,terms_version)
  values(p_program,p_family,p_children,program.class_ids,p_user,p_environment,p_location,cardinality(p_children)*program.price_cents-discount,discount,email,p_source,program.due_at,program.terms_version) returning * into sale;
  return sale;
end $$;

create function public.hold_class_series_sale(p_id uuid,p_invoice boolean)
returns public.class_series_sales language plpgsql security definer set search_path=public as $$
declare sale class_series_sales; program class_series_programs; session record; booked integer; held integer;
begin
  select * into strict sale from class_series_sales where id=p_id;
  perform pg_advisory_xact_lock(hashtextextended('class-series:'||sale.program_id,0));
  select * into strict sale from class_series_sales where id=p_id for update;
  select * into strict program from class_series_programs where id=sale.program_id;
  if not program.payments_enabled then raise exception 'Paid registration is not open yet'; end if;
  if now()>=sale.due_at then raise exception 'Payment deadline has passed'; end if;
  if sale.status='held' then return sale; end if;
  if sale.status<>'draft' then raise exception 'This payment requires review'; end if;
  if sale.square_invoice_id is null or sale.square_order_id is null then raise exception 'Invoice is not ready'; end if;
  if (select count(*) from classes where id=any(sale.class_ids))<>cardinality(sale.class_ids) then raise exception 'The full series schedule needs review'; end if;
  if exists(select 1 from class_registrations where class_id=any(sale.class_ids) and person_id=any(sale.child_ids) and status in ('scheduled','attended')) then raise exception 'A selected child already has a confirmed registration'; end if;
  for session in select * from classes where id=any(sale.class_ids) order by id for update loop
    if session.status<>'scheduled' or session.price_cents<>program.price_cents or session.capacity is null then raise exception 'Series schedule, class size, or price needs review'; end if;
    select count(*) into booked from class_registrations where class_id=session.id and status in ('scheduled','attended');
    select coalesce(sum(cardinality(child_ids)),0) into held from class_series_sales where program_id=sale.program_id and environment=sale.environment and status in ('held','review') and id<>sale.id;
    if booked+held+cardinality(sale.child_ids)>session.capacity then raise exception 'Not enough seats remain for the full series. You can still register your interest'; end if;
  end loop;
  update class_series_sales set status='held',hold_until=case when p_invoice then due_at else least(due_at,now()+interval '20 minutes') end where id=p_id returning * into sale;
  return sale;
end $$;

create function public.fulfill_class_series_sale(p_id uuid,p_order text,p_payments text[],p_amount integer)
returns public.class_series_sales language plpgsql security definer set search_path=public as $$
declare sale class_series_sales; session record; child uuid; booked integer; held integer; receipt text;
begin
  select * into strict sale from class_series_sales where id=p_id;
  perform pg_advisory_xact_lock(hashtextextended('class-series:'||sale.program_id,0));
  select * into strict sale from class_series_sales where id=p_id for update;
  if sale.square_order_id is distinct from p_order or sale.amount_cents<>p_amount or coalesce(cardinality(p_payments),0)=0 then raise exception 'Verified payment does not match'; end if;
  if sale.status='paid' then return sale; end if;
  if sale.status not in ('held','draft') then raise exception 'This payment requires owner review'; end if;
  if (select count(*) from classes where id=any(sale.class_ids))<>cardinality(sale.class_ids) then raise exception 'The full series schedule needs review'; end if;
  for session in select * from classes where id=any(sale.class_ids) order by id for update loop
    select count(*) into booked from class_registrations where class_id=session.id and status in ('scheduled','attended') and not(person_id=any(sale.child_ids));
    select coalesce(sum(cardinality(child_ids)),0) into held from class_series_sales where program_id=sale.program_id and environment=sale.environment and status in ('held','review') and id<>sale.id;
    if session.status<>'scheduled' or session.capacity is null or booked+held+cardinality(sale.child_ids)>session.capacity then
      update class_series_sales set status='review' where id=p_id returning * into sale; return sale;
    end if;
  end loop;
  foreach receipt in array p_payments loop
    insert into class_series_payment_receipts(environment,payment_id,sale_id) values(sale.environment,receipt,sale.id);
  end loop;
  foreach child in array sale.child_ids loop
    insert into class_registrations(class_id,person_id,household_id,child_id,status,created_by_user_id,created_by_role)
      select id,child,sale.household_id,child,'scheduled',sale.created_by_user_id,'customer' from classes where id=any(sale.class_ids)
      on conflict(class_id,person_id) do update set status='scheduled',household_id=excluded.household_id,child_id=excluded.child_id,
      waitlist_offer_token=null,waitlist_offer_expires_at=null,waitlist_offered_at=null;
  end loop;
  update class_series_sales set status='paid',paid_at=now() where id=p_id returning * into sale;
  return sale;
end $$;

create function public.cancel_class_series_sale(p_id uuid,p_provider_status text)
returns void language plpgsql security definer set search_path=public as $$
declare sale class_series_sales;
begin
  select * into strict sale from class_series_sales where id=p_id;
  perform pg_advisory_xact_lock(hashtextextended('class-series:'||sale.program_id,0));
  select * into strict sale from class_series_sales where id=p_id for update;
  if sale.status='paid' or sale.status='review' or p_provider_status not in ('CANCELED','DELETED') then raise exception 'Verify the unpaid invoice is closed before releasing seats'; end if;
  update class_series_sales set status='cancelled' where id=p_id;
end $$;

revoke all on function public.prepare_class_series_sale(text,uuid,uuid[],uuid,text,text,text),public.hold_class_series_sale(uuid,boolean),public.fulfill_class_series_sale(uuid,text,text[],integer),public.cancel_class_series_sale(uuid,text) from public,anon,authenticated;
grant execute on function public.prepare_class_series_sale(text,uuid,uuid[],uuid,text,text,text),public.hold_class_series_sale(uuid,boolean),public.fulfill_class_series_sale(uuid,text,text[],integer),public.cancel_class_series_sale(uuid,text) to service_role;
notify pgrst,'reload schema';
commit;
