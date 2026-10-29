begin;

-- A program is an explicit, server-managed set of class occurrences sold once.
-- Ordinary weekly classes keep a null program_key and are charged per occurrence.
alter table public.square_catalog_mappings add column program_key text;
create index square_catalog_class_program_key
  on public.square_catalog_mappings(environment,program_key) where kind='class' and program_key is not null;

create or replace function public.prepare_square_checkout(
  p_household uuid, p_kind text, p_environment text, p_location text, p_user uuid, p_role text, p_request jsonb
) returns public.square_checkout_attempts language plpgsql security definer set search_path = public as $$
declare
  a square_checkout_attempts; selected classes; session classes; item jsonb; participant record; registration record;
  assigned jsonb := '[]'; lines jsonb := '[]'; seen jsonb := '{}';
  variation text; program text; billing_key text; session_ids uuid[]; participant_ids uuid[];
  total integer := 0; quantity integer; seats integer; held integer;
begin
  perform pg_advisory_xact_lock(hashtext('little-wanderers-square-checkout'));
  select * into a from square_checkout_attempts where household_id=p_household and kind=p_kind
    and environment=p_environment and status in ('creating','open') limit 1;
  if found then
    if a.payload->'request' <> p_request then raise exception 'Finish the existing checkout before starting another'; end if;
    return a;
  end if;
  if p_kind = 'membership' then
    if exists(select 1 from memberships where household_id=p_household and (renews_at is null or renews_at > now()
      or (square_subscription_id is not null and square_status not in ('CANCELED','COMPLETED')))) then
      raise exception 'A membership already exists for this household';
    end if;
    total := 6000;
  elsif p_kind = 'class' then
    if not exists(select 1 from people where id=(p_request->>'person_id')::uuid and household_id=p_household) then
      raise exception 'Participant not found in household';
    end if;
    if jsonb_array_length(p_request->'items') = 0 then raise exception 'Classes are required'; end if;
    for item in select value from jsonb_array_elements(p_request->'items') loop
      quantity := (item->>'quantity')::integer;
      if quantity < 1 or quantity > 30 then raise exception 'Invalid class quantity'; end if;
      select * into strict selected from classes where id=(item->>'class_id')::uuid for update;
      if selected.status <> 'scheduled' or selected.price_cents <= 0 then raise exception 'Class is not available for paid booking'; end if;
      select m.variation_id,m.program_key into variation,program from square_catalog_mappings m
        where m.environment=p_environment and m.kind='class' and m.entity_key=selected.id::text;
      if p_environment='production' and variation is null then raise exception 'Production class catalog mapping is missing'; end if;
      billing_key := coalesce('program:' || program,'class:' || selected.id::text);
      if seen ? billing_key then
        if (seen->>billing_key)::integer <> quantity then raise exception 'Program quantities must match'; end if;
        continue;
      end if;
      seen := seen || jsonb_build_object(billing_key,quantity);
      if program is null then
        session_ids := array[selected.id];
      else
        select array_agg(c.id order by c.id) into session_ids from square_catalog_mappings m
          join classes c on m.entity_key=c.id::text
          where m.environment=p_environment and m.kind='class' and m.program_key=program;
        if cardinality(session_ids) < 2 or exists(
          select 1 from square_catalog_mappings m left join classes c on m.entity_key=c.id::text
          where m.environment=p_environment and m.kind='class' and m.program_key=program
            and (c.id is null or m.variation_id<>variation or c.price_cents<>selected.price_cents)
        ) then raise exception 'Program pricing or catalog mapping is inconsistent'; end if;
      end if;
      -- Select the same participants across every occurrence. Never silently substitute a sibling
      -- when the requested child already has a seat or a waitlist entry in one occurrence.
      select array_agg(p.id order by (p.id=(p_request->>'person_id')::uuid) desc,p.created_at,p.id)
        into participant_ids from (
          select p.* from people p where p.household_id=p_household and not exists(
            select 1 from class_registrations r where r.person_id=p.id and r.class_id=any(session_ids)
              and r.status not in ('cancelled','preregistered')
          ) order by (p.id=(p_request->>'person_id')::uuid) desc,p.created_at,p.id limit quantity
        ) p;
      if coalesce(cardinality(participant_ids),0)<>quantity
        or not ((p_request->>'person_id')::uuid=any(participant_ids)) then
        raise exception 'Selected participant is not eligible for every class occurrence';
      end if;
      for session in select * from classes where id=any(session_ids) order by id for update loop
        if session.status<>'scheduled' then raise exception 'A program occurrence is not available'; end if;
        if program is not null and session.start_time<=now() then raise exception 'Program has started; please contact staff'; end if;
        select count(*) into seats from class_registrations where class_id=session.id and status in ('scheduled','attended');
        select count(*) into held from square_checkout_attempts x,
          lateral jsonb_array_elements(x.payload->'assignments') r
          where x.status in ('creating','open') and r->>'class_id'=session.id::text;
        held := held + (select count(*) from jsonb_array_elements(assigned) r where r->>'class_id'=session.id::text);
        if session.capacity is not null and seats+held+quantity>session.capacity then
          raise exception 'Class does not have enough seats for every occurrence';
        end if;
        for participant in select * from people where id=any(participant_ids) order by id loop
          if assigned @> jsonb_build_array(jsonb_build_object('class_id',session.id,'person_id',participant.id)) then
            raise exception 'Duplicate class request';
          end if;
          select r.id,r.status into registration from class_registrations r
            where r.person_id=participant.id and r.class_id=session.id;
          assigned := assigned || jsonb_build_array(jsonb_build_object('class_id',session.id,'person_id',participant.id,
            'child_id',case when participant.role='child' then participant.id else null end,
            'registration_id',registration.id,'registration_status',registration.status));
        end loop;
      end loop;
      lines := lines || jsonb_build_array(jsonb_build_object('quantity',quantity::text,
        'base_price_money',jsonb_build_object('amount',selected.price_cents,'currency','USD'))
        || case when variation is null then jsonb_build_object('name',selected.title) else jsonb_build_object('catalog_object_id',variation) end);
      total := total + selected.price_cents*quantity;
    end loop;
  else raise exception 'Invalid checkout type'; end if;
  insert into square_checkout_attempts(household_id,kind,environment,location_id,expected_amount_cents,payload,created_by_user_id,created_by_role)
    values(p_household,p_kind,p_environment,p_location,total,jsonb_build_object('request',p_request,'assignments',assigned,'line_items',lines),p_user,p_role)
    returning * into a;
  return a;
end $$;

notify pgrst, 'reload schema';
commit;
