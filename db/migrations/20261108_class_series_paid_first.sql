-- Pending Square invoices and checkouts do not reserve class seats.
-- The legacy 'held' status means awaiting payment only. Confirm verified payments
-- atomically against confirmed registrations; excess payments require owner review.
begin;
create or replace function public.hold_class_series_sale(p_id uuid,p_invoice boolean)
returns public.class_series_sales language plpgsql security definer set search_path=public as $$
declare sale class_series_sales; program class_series_programs; session record; booked integer;
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
    if not p_invoice and booked+cardinality(sale.child_ids)>session.capacity then raise exception 'Not enough seats remain for the full series. You can still register your interest'; end if;
  end loop;
  update class_series_sales set status='held',hold_until=due_at where id=p_id returning * into sale;
  return sale;
end $$;

create or replace function public.fulfill_class_series_sale(p_id uuid,p_order text,p_payments text[],p_amount integer)
returns public.class_series_sales language plpgsql security definer set search_path=public as $$
declare sale class_series_sales; session record; child uuid; booked integer; receipt text;
begin
  select * into strict sale from class_series_sales where id=p_id;
  perform pg_advisory_xact_lock(hashtextextended('class-series:'||sale.program_id,0));
  select * into strict sale from class_series_sales where id=p_id for update;
  if sale.square_order_id is distinct from p_order or sale.amount_cents<>p_amount or coalesce(cardinality(p_payments),0)=0 then raise exception 'Verified payment does not match'; end if;
  if sale.status in ('paid','review') then return sale; end if;
  if sale.status not in ('held','draft') then raise exception 'This payment requires owner review'; end if;
  if (select count(*) from classes where id=any(sale.class_ids))<>cardinality(sale.class_ids) then raise exception 'The full series schedule needs review'; end if;
  foreach receipt in array p_payments loop
    insert into class_series_payment_receipts(environment,payment_id,sale_id) values(sale.environment,receipt,sale.id);
  end loop;
  for session in select * from classes where id=any(sale.class_ids) order by id for update loop
    select count(*) into booked from class_registrations where class_id=session.id and status in ('scheduled','attended') and not(person_id=any(sale.child_ids));
    if session.status<>'scheduled' or session.capacity is null or booked+cardinality(sale.child_ids)>session.capacity then
      update class_series_sales set status='review',paid_at=coalesce(paid_at,now()),hold_until=null where id=p_id returning * into sale; return sale;
    end if;
  end loop;
  foreach child in array sale.child_ids loop
    insert into class_registrations(class_id,person_id,household_id,child_id,status,created_by_user_id,created_by_role)
      select id,child,sale.household_id,child,'scheduled',sale.created_by_user_id,'customer' from classes where id=any(sale.class_ids)
      on conflict(class_id,person_id) do update set status='scheduled',household_id=excluded.household_id,child_id=excluded.child_id,
      waitlist_offer_token=null,waitlist_offer_expires_at=null,waitlist_offered_at=null;
  end loop;
  update class_series_sales set status='paid',paid_at=coalesce(paid_at,now()),hold_until=null where id=p_id returning * into sale;
  return sale;
end $$;

-- Keep existing payment pages available until the published payment deadline.
-- This changes no Square invoices, emails, charges, or confirmed registrations.
update public.class_series_sales set hold_until=due_at where status='held';
notify pgrst,'reload schema';
commit;
