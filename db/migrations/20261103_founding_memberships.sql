begin;

-- Separate reservations from paid memberships. Saving a card never grants a paid term.
create table public.founding_memberships (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id),
  user_id uuid not null references auth.users(id),
  environment text not null check(environment in ('sandbox','production')),
  status text not null default 'draft' check(status in ('draft','saving_card','pending','activating','scheduled','active','canceling','canceled')),
  square_customer_id text,
  square_card_id text,
  square_subscription_id text unique,
  card_brand text,
  card_last4 text,
  child_ids uuid[] not null,
  birthdates date[] not null,
  amount_cents integer not null check(amount_cents >= 5000 and (amount_cents-5000)%2000=0),
  start_date date,
  paid_through date,
  terms_version text not null,
  terms_snapshot text not null,
  profile_snapshot jsonb not null,
  consent_at timestamptz not null default now(),
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(household_id,environment),
  check(card_last4 is null or card_last4 ~ '^[0-9]{4}$'),
  check(cardinality(child_ids)>0 and cardinality(child_ids)=cardinality(birthdates)),
  check(status not in ('pending','activating','scheduled','active') or square_card_id is not null),
  check(status not in ('scheduled','active') or (square_subscription_id is not null and start_date is not null))
);
alter table public.founding_memberships enable row level security;
-- All mutations and reads use authenticated server routes. No browser table grants.
revoke all on public.founding_memberships from anon, authenticated;
grant all on public.founding_memberships to service_role;

-- Commit the full family profile, selected children, and consent atomically.
-- Explicit IDs make retried submissions update people instead of creating duplicates.
create or replace function public.prepare_founding_membership(p_user uuid,p_household uuid,p_environment text,p_profile jsonb,p_terms text,p_version text,p_amount integer)
returns public.founding_memberships language plpgsql security definer set search_path=public as $$
declare enrollment public.founding_memberships; child jsonb; person uuid; ids uuid[]:='{}'; births date[]:='{}';
begin
  perform 1 from households where id=p_household for update;
  if not exists(select 1 from household_members where household_id=p_household and user_id=p_user and role in ('primary_caregiver','caregiver','owner','admin')) then
    raise exception 'A family caregiver must enroll.';
  end if;
  select * into enrollment from founding_memberships where household_id=p_household and environment=p_environment for update;
  if found and enrollment.status not in ('draft') then return enrollment; end if;
  -- Never replace a different family's person, or convert adults into children.
  for child in select * from jsonb_array_elements(p_profile->'children') loop
    person := (child->>'id')::uuid;
    if exists(select 1 from people where id=person and (household_id is distinct from p_household or role is distinct from 'child')) then raise exception 'Invalid child.'; end if;
    insert into people(id,household_id,role,first_name,last_name,gender,birthdate)
      values(person,p_household,'child',child->>'firstName',nullif(child->>'lastName',''),child->>'gender',(child->>'birthdate')::date)
      on conflict(id) do update set first_name=excluded.first_name,last_name=excluded.last_name,gender=excluded.gender,birthdate=excluded.birthdate;
    ids:=array_append(ids,person); births:=array_append(births,(child->>'birthdate')::date);
  end loop;
  if exists(select 1 from people where household_id=p_household and role='child' and not(id=any(ids))) then raise exception 'Include all children in your family profile.'; end if;
  if cardinality(ids)=0 or cardinality(ids)<>(select count(distinct x) from unnest(ids) x) then raise exception 'Add each child once.'; end if;
  select id into person from people where household_id=p_household and role='adult' order by created_at limit 1;
  if person is null then
    insert into people(household_id,role,first_name,last_name,gender) values(p_household,'adult',p_profile->>'adultFirstName',p_profile->>'adultLastName',p_profile->>'adultGender');
  else
    update people set first_name=p_profile->>'adultFirstName',last_name=p_profile->>'adultLastName',gender=p_profile->>'adultGender' where id=person;
  end if;
  update households set name=(p_profile->>'adultLastName')||' Family',email=p_profile->>'email',phone=p_profile->>'phone',city=p_profile->>'city',state=p_profile->>'state' where id=p_household;
  insert into founding_memberships(household_id,user_id,environment,child_ids,birthdates,amount_cents,terms_version,terms_snapshot,profile_snapshot)
    values(p_household,p_user,p_environment,ids,births,p_amount,p_version,p_terms,p_profile)
    on conflict(household_id,environment) do update set child_ids=excluded.child_ids,birthdates=excluded.birthdates,amount_cents=excluded.amount_cents,terms_version=excluded.terms_version,terms_snapshot=excluded.terms_snapshot,profile_snapshot=excluded.profile_snapshot,consent_at=now(),updated_at=now()
    returning * into enrollment;
  return enrollment;
end;
$$;
revoke all on function public.prepare_founding_membership(uuid,uuid,text,jsonb,text,text,integer) from public,anon,authenticated;
grant execute on function public.prepare_founding_membership(uuid,uuid,text,jsonb,text,text,integer) to service_role;

-- A compare-and-set claim serializes activation, cancellation, and card enrollment.
create or replace function public.claim_founding_operation(p_id uuid,p_from text,p_to text,p_start date default null)
returns public.founding_memberships language sql security definer set search_path=public as $$
  update founding_memberships set status=p_to,start_date=coalesce(start_date,p_start),updated_at=now() where id=p_id and status=p_from returning *;
$$;
revoke all on function public.claim_founding_operation(uuid,text,text,date) from public,anon,authenticated;
grant execute on function public.claim_founding_operation(uuid,text,text,date) to service_role;

notify pgrst, 'reload schema';
commit;
