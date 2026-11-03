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
  pricing_tier text not null check(pricing_tier in ('waitlist','public','regular')),
  base_cents integer not null,
  sibling_cents integer not null,
  amount_cents integer not null,
  check((pricing_tier='waitlist' and base_cents=5000 and sibling_cents=1000) or (pricing_tier='public' and base_cents=5000 and sibling_cents=2000) or (pricing_tier='regular' and base_cents=6000 and sibling_cents=2000)),
  check(amount_cents>=base_cents and (amount_cents-base_cents)%sibling_cents=0),
  start_date date,
  paid_through date,
  terms_version text not null,
  terms_snapshot text not null,
  profile_snapshot jsonb not null,
  consent_at timestamptz not null default now(),
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(card_last4 is null or card_last4 ~ '^[0-9]{4}$'),
  check(cardinality(child_ids)>0 and cardinality(child_ids)=cardinality(birthdates)),
  check(status not in ('pending','activating','scheduled','active') or square_card_id is not null),
  check(status not in ('scheduled','active') or (square_subscription_id is not null and start_date is not null))
);
create unique index founding_memberships_one_current on public.founding_memberships(household_id,environment) where status<>'canceled';
alter table public.founding_memberships enable row level security;
-- All mutations and reads use authenticated server routes. No browser table grants.
revoke all on public.founding_memberships from anon, authenticated;
grant all on public.founding_memberships to service_role;

-- Rollout is explicit: waitlist first, public next, regular after opening.
-- Changing the phase never starts billing or reprices a saved membership.
create table public.founding_membership_settings (
  environment text primary key check(environment in ('sandbox','production')),
  phase text not null default 'waitlist' check(phase in ('waitlist','public','regular')),
  card_enrollment_enabled boolean not null default false
);
insert into public.founding_membership_settings(environment) values('sandbox'),('production');
alter table public.founding_membership_settings enable row level security;
revoke all on public.founding_membership_settings from anon,authenticated;
grant all on public.founding_membership_settings to service_role;

create function public.founding_membership_offer(p_user uuid,p_household uuid,p_environment text)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare phase text; cards_enabled boolean; tier text; eligible boolean:=false; email text; local_part text; domain_part text; lapsed boolean; saved public.founding_memberships;
begin
  select s.phase,s.card_enrollment_enabled into strict phase,cards_enabled from founding_membership_settings s where environment=p_environment;
  select * into saved from founding_memberships f where f.household_id=p_household and f.environment=p_environment and f.status not in ('draft','canceled');
  if found then
    return jsonb_build_object('phase',phase,'tier',saved.pricing_tier,'can_enroll',saved.status<>'canceling','card_enrollment_enabled',cards_enabled,'base_cents',saved.base_cents,'sibling_cents',saved.sibling_cents);
  end if;
  select lower(regexp_replace(u.email,'[[:space:]]','','g')) into email from auth.users u where u.id=p_user;
  local_part:=split_part(email,'@',1);domain_part:=split_part(email,'@',2);
  if domain_part in ('gmail.com','googlemail.com') then
    email:=replace(split_part(local_part,'+',1),'.','')||'@gmail.com';
  end if;
  select exists(select 1 from waitlist_entries w where w.created_at<timestamptz '2026-10-29T00:00:00-04:00'
    and (w.claimed_user_id=p_user or w.normalized_email=email)) into eligible;
  select exists(select 1 from founding_memberships f where (f.household_id=p_household or f.user_id=p_user) and f.environment=p_environment and f.status='canceled') into lapsed;
  tier:=case when lapsed or phase='regular' then 'regular' when eligible or phase='waitlist' then 'waitlist' else 'public' end;
  return jsonb_build_object('phase',phase,'tier',tier,'can_enroll',lapsed or phase<>'waitlist' or eligible,'card_enrollment_enabled',cards_enabled,
    'base_cents',case when tier='regular' then 6000 else 5000 end,'sibling_cents',case when tier='waitlist' then 1000 else 2000 end);
end;
$$;
revoke all on function public.founding_membership_offer(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.founding_membership_offer(uuid,uuid,text) to service_role;

-- Commit the full family profile, selected children, and consent atomically.
-- Explicit IDs make retried submissions update people instead of creating duplicates.
create or replace function public.prepare_founding_membership(p_user uuid,p_household uuid,p_environment text,p_profile jsonb,p_terms text,p_version text,p_amount integer,p_tier text)
returns public.founding_memberships language plpgsql security definer set search_path=public as $$
declare enrollment public.founding_memberships; child jsonb; person uuid; ids uuid[]:='{}'; births date[]:='{}'; offer jsonb;
begin
  perform 1 from households where id=p_household for update;
  if not exists(select 1 from household_members where household_id=p_household and user_id=p_user and role in ('primary_caregiver','caregiver','owner','admin')) then
    raise exception 'A family caregiver must enroll.';
  end if;
  perform 1 from founding_membership_settings where environment=p_environment for share;
  select * into enrollment from founding_memberships where household_id=p_household and environment=p_environment and status<>'canceled' for update;
  if found and enrollment.status not in ('draft') then return enrollment; end if;
  offer:=public.founding_membership_offer(p_user,p_household,p_environment);
  if not (offer->>'can_enroll')::boolean or p_tier is distinct from offer->>'tier' then raise exception 'Membership offer changed. Refresh before enrolling.'; end if;
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
  if enrollment.id is null then
    insert into founding_memberships(household_id,user_id,environment,child_ids,birthdates,amount_cents,terms_version,terms_snapshot,profile_snapshot,pricing_tier,base_cents,sibling_cents)
      values(p_household,p_user,p_environment,ids,births,p_amount,p_version,p_terms,p_profile,p_tier,(offer->>'base_cents')::integer,(offer->>'sibling_cents')::integer)
      returning * into enrollment;
  else
    update founding_memberships set child_ids=ids,birthdates=births,amount_cents=p_amount,terms_version=p_version,terms_snapshot=p_terms,profile_snapshot=p_profile,pricing_tier=p_tier,base_cents=(offer->>'base_cents')::integer,sibling_cents=(offer->>'sibling_cents')::integer,consent_at=now(),updated_at=now()
      where id=enrollment.id returning * into enrollment;
  end if;
  return enrollment;
end;
$$;
revoke all on function public.prepare_founding_membership(uuid,uuid,text,jsonb,text,text,integer,text) from public,anon,authenticated;
grant execute on function public.prepare_founding_membership(uuid,uuid,text,jsonb,text,text,integer,text) to service_role;

-- A compare-and-set claim serializes activation, cancellation, and card enrollment.
create or replace function public.claim_founding_operation(p_id uuid,p_from text,p_to text,p_start date default null)
returns public.founding_memberships language sql security definer set search_path=public as $$
  update founding_memberships set status=p_to,start_date=coalesce(start_date,p_start),updated_at=now() where id=p_id and status=p_from returning *;
$$;
revoke all on function public.claim_founding_operation(uuid,text,text,date) from public,anon,authenticated;
grant execute on function public.claim_founding_operation(uuid,text,text,date) to service_role;

notify pgrst, 'reload schema';
commit;
