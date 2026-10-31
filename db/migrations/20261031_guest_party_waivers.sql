begin;

-- Guests use the existing family/person/waiver records. Email verification is
-- independent of Supabase Auth: requesting a waiver never creates an account.
create table public.guest_waiver_identities (
  email text primary key check (email = lower(trim(email))),
  household_id uuid not null references public.households(id) on delete restrict,
  verified_at timestamptz not null default now()
);
create table public.guest_waiver_sessions (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  email text not null,
  code_hash text not null,
  ip_hash text not null,
  party_booking_id uuid references public.party_bookings(id) on delete restrict,
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  code_expires_at timestamptz not null default now() + interval '15 minutes',
  verified_at timestamptz,
  expires_at timestamptz not null default now() + interval '2 hours',
  waiver_id uuid references public.waivers(id) on delete restrict
);
create index guest_waiver_sessions_email_created on public.guest_waiver_sessions(email,created_at);
create index guest_waiver_sessions_ip_created on public.guest_waiver_sessions(ip_hash,created_at);
create table public.party_guest_waivers (
  party_booking_id uuid not null references public.party_bookings(id) on delete restrict,
  waiver_id uuid not null references public.waivers(id) on delete restrict,
  household_id uuid not null references public.households(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key(party_booking_id,waiver_id)
);
alter table public.guest_waiver_identities enable row level security;
alter table public.guest_waiver_sessions enable row level security;
alter table public.party_guest_waivers enable row level security;
revoke all on public.guest_waiver_identities, public.guest_waiver_sessions, public.party_guest_waivers from public,anon,authenticated;
grant all on public.guest_waiver_identities, public.guest_waiver_sessions, public.party_guest_waivers to service_role;

create function public.begin_guest_waiver(p_email text,p_token_hash text,p_code_hash text,p_ip_hash text,p_party uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  perform pg_advisory_xact_lock(hashtext('guest-waiver-requests'));
  if p_email <> lower(trim(p_email)) or length(p_email)>254 or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or length(p_token_hash)<>64 or length(p_code_hash)<>64 or length(p_ip_hash)<>64 then
    raise exception 'Invalid verification request';
  end if;
  if p_party is not null and not exists(select 1 from party_bookings where id=p_party and status in ('confirmed','early_access_hold')) then
    return jsonb_build_object('ok',false,'code','party_unavailable');
  end if;
  if exists(select 1 from guest_waiver_sessions where email=p_email and created_at>now()-interval '60 seconds')
    or (select count(*) from guest_waiver_sessions where email=p_email and created_at>now()-interval '15 minutes')>=3
    or (select count(*) from guest_waiver_sessions where ip_hash=p_ip_hash and created_at>now()-interval '15 minutes')>=40 then
    return jsonb_build_object('ok',false,'code','rate_limited');
  end if;
  insert into guest_waiver_sessions(email,token_hash,code_hash,ip_hash,party_booking_id)
    values(p_email,p_token_hash,p_code_hash,p_ip_hash,p_party);
  return jsonb_build_object('ok',true);
end $$;

create function public.verify_guest_waiver(p_token_hash text,p_code_hash text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare s guest_waiver_sessions;
begin
  select * into s from guest_waiver_sessions where token_hash=p_token_hash for update;
  if not found or s.expires_at<=now() or s.code_expires_at<=now() or s.attempts>=5 then
    return jsonb_build_object('ok',false,'code','verification_expired');
  end if;
  if s.verified_at is not null then return jsonb_build_object('ok',true); end if;
  -- Do not throw on a failed attempt: its counter must commit.
  update guest_waiver_sessions set attempts=attempts+1 where id=s.id;
  if s.code_hash is distinct from p_code_hash then return jsonb_build_object('ok',false,'code','incorrect_code'); end if;
  update guest_waiver_sessions set verified_at=now() where id=s.id;
  return jsonb_build_object('ok',true);
end $$;

create function public.guest_waiver_household(p_email text)
returns uuid language plpgsql security definer set search_path=public as $$
declare existing uuid; candidates uuid[];
begin
  select household_id into existing from guest_waiver_identities where email=p_email;
  -- Only the verified email of an actual caregiver can identify an account.
  -- A household's editable contact email or phone is not proof of access.
  select array_agg(distinct hm.household_id) into candidates from household_members hm join auth.users u on u.id=hm.user_id
    where lower(trim(u.email))=p_email and u.email_confirmed_at is not null
    and hm.role in ('primary_caregiver','caregiver','owner','admin')
    and exists(select 1 from people p where p.household_id=hm.household_id);
  if cardinality(candidates)>1 or (existing is not null and cardinality(candidates)=1 and existing<>candidates[1]) then
    raise exception 'Please ask the front desk to link your family records';
  end if;
  return coalesce(existing,candidates[1]);
end $$;

create function public.guest_waiver_children(p_household uuid)
returns jsonb language sql stable security definer set search_path=public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'first_name',first_name,'last_name',last_name,'birthdate',birthdate) order by id),'[]'::jsonb)
    from people where household_id=p_household and role='child';
$$;

create function public.guest_waiver_context(p_token_hash text,p_version text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare s guest_waiver_sessions; family uuid; party_date timestamptz; saved jsonb;
begin
  select * into s from guest_waiver_sessions where token_hash=p_token_hash and verified_at is not null and expires_at>now();
  if not found then return jsonb_build_object('verified',false); end if;
  family:=guest_waiver_household(s.email);
  select jsonb_build_object('id',w.id,'signed_at',w.signed_at,'expires_at',w.waiver_expires_at) into saved from waivers w
    where w.household_id=family and w.waiver_version=p_version and w.signed_at<=now() and w.waiver_expires_at>now() and length(trim(w.electronic_signature))>=2
      and not exists(select 1 from people p where p.household_id=family and p.role='child' and not(p.id=any(coalesce(w.covered_person_ids,'{}'::uuid[]))))
    order by w.signed_at desc limit 1;
  if s.party_booking_id is not null then select start_time into party_date from party_bookings where id=s.party_booking_id; end if;
  return jsonb_build_object('verified',true,'email',s.email,'children',guest_waiver_children(family),
    'party_id',s.party_booking_id,'party_date',party_date,'waiver_id',s.waiver_id,'existing_waiver',saved);
end $$;

create function public.use_guest_waiver(p_token_hash text,p_waiver uuid,p_version text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare s guest_waiver_sessions; family uuid; w waivers;
begin
  select * into s from guest_waiver_sessions where token_hash=p_token_hash for update;
  if not found or s.verified_at is null or s.expires_at<=now() then raise exception 'Please verify your email again'; end if;
  family:=guest_waiver_household(s.email);
  if family is null then raise exception 'No saved waiver found'; end if;
  perform 1 from households where id=family for update;
  select * into w from waivers where id=p_waiver and household_id=family and waiver_version=p_version
    and signed_at<=now() and waiver_expires_at>now() and length(trim(electronic_signature))>=2;
  if not found or exists(select 1 from people p where p.household_id=family and p.role='child' and not(p.id=any(coalesce(w.covered_person_ids,'{}'::uuid[])))) then
    raise exception 'Please review and renew your waiver';
  end if;
  if s.party_booking_id is not null then
    if not exists(select 1 from party_bookings where id=s.party_booking_id and status in ('confirmed','early_access_hold')) then raise exception 'This party is no longer available'; end if;
    insert into party_guest_waivers(party_booking_id,waiver_id,household_id) values(s.party_booking_id,w.id,family) on conflict do nothing;
  end if;
  update guest_waiver_sessions set waiver_id=w.id where id=s.id;
  return jsonb_build_object('waiver_id',w.id,'signed_at',w.signed_at,'expires_at',w.waiver_expires_at);
end $$;

create function public.sign_guest_waiver(p_token_hash text,p_expected_children jsonb,p_profile jsonb,p_version text,p_snapshot jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare s guest_waiver_sessions; family uuid; child jsonb; child_id uuid; children jsonb;
  signature text:=trim(p_profile->>'signature'); w public.waivers; child_ids uuid[]; existing_count integer;
begin
  select * into s from guest_waiver_sessions where token_hash=p_token_hash for update;
  if not found or s.verified_at is null or s.expires_at<=now() then raise exception 'Please verify your email again'; end if;
  if s.waiver_id is not null then
    select * into w from waivers where id=s.waiver_id;
    return jsonb_build_object('waiver_id',w.id,'signed_at',w.signed_at,'expires_at',w.waiver_expires_at);
  end if;
  if s.party_booking_id is not null and not exists(select 1 from party_bookings where id=s.party_booking_id and status in ('confirmed','early_access_hold')) then
    raise exception 'This party is no longer available';
  end if;
  if length(signature) not between 2 and 150 or length(p_profile->>'first_name') not between 1 and 100
    or length(p_profile->>'last_name') not between 1 and 100 or p_profile->>'phone' !~ '^\+[1-9][0-9]{7,14}$'
    or jsonb_typeof(p_profile->'children')<>'array' or jsonb_array_length(p_profile->'children')>10
    or p_snapshot->>'is_guardian'<>'true' or p_snapshot->>'electronic_consent'<>'true' or length(p_version)<1 then
    raise exception 'Complete all required waiver fields';
  end if;
  perform pg_advisory_xact_lock(hashtext('guest-waiver-family:'||s.email));
  family:=guest_waiver_household(s.email);
  if family is not null then perform 1 from households where id=family for update; end if;
  if guest_waiver_children(family) is distinct from p_expected_children then raise exception 'Your family changed. Reload and review the children before signing'; end if;
  if family is null then
    insert into households(name,email,phone,role) values(trim(p_profile->>'last_name')||' Family',s.email,p_profile->>'phone','primary_caregiver') returning id into family;
  end if;
  if not exists(select 1 from people where household_id=family and role='adult'
    and lower(trim(first_name))=lower(trim(p_profile->>'first_name')) and lower(trim(coalesce(last_name,'')))=lower(trim(p_profile->>'last_name'))) then
    insert into people(household_id,role,first_name,last_name) values(family,'adult',trim(p_profile->>'first_name'),trim(p_profile->>'last_name'));
  end if;
  for child in select value from jsonb_array_elements(p_profile->'children') loop
    if length(trim(child->>'first_name')) not between 1 and 100 or length(trim(child->>'last_name')) not between 1 and 100
      or (child->>'birthdate')::date>current_date or (child->>'birthdate')::date<'1900-01-01'::date then raise exception 'Enter a valid child name and birthday'; end if;
    select count(*) into existing_count from people where household_id=family and role='child'
      and lower(trim(first_name))=lower(trim(child->>'first_name')) and lower(trim(coalesce(last_name,'')))=lower(trim(child->>'last_name'));
    if existing_count>1 or exists(select 1 from people where household_id=family and role='child'
      and lower(trim(first_name))=lower(trim(child->>'first_name')) and lower(trim(coalesce(last_name,'')))=lower(trim(child->>'last_name'))
      and birthdate is distinct from (child->>'birthdate')::date) then raise exception 'Please ask the front desk to check this child record'; end if;
    if existing_count=0 then
      insert into people(household_id,role,first_name,last_name,birthdate)
        values(family,'child',trim(child->>'first_name'),trim(child->>'last_name'),(child->>'birthdate')::date);
    end if;
  end loop;
  children:=guest_waiver_children(family);
  if jsonb_array_length(children)=0 then raise exception 'Add at least one child'; end if;
  select array_agg((value->>'id')::uuid) into child_ids from jsonb_array_elements(children);
  insert into waivers(household_id,signed_at,signed_date,waiver_expires_at,parent_name,electronic_signature,email,phone,photo_consent,source,waiver_version,covered_person_ids,agreement_snapshot)
    values(family,now(),now(),now()+interval '90 days',signature,signature,s.email,p_profile->>'phone',
      (p_profile->>'photo_consent')::boolean,'guest_website',p_version,child_ids,
      p_snapshot||jsonb_build_object('children',children,'verified_email',s.email,'email_verified_at',s.verified_at)) returning * into w;
  insert into guest_waiver_identities(email,household_id) values(s.email,family)
    on conflict(email) do update set verified_at=now();
  if s.party_booking_id is not null then
    insert into party_guest_waivers(party_booking_id,waiver_id,household_id) values(s.party_booking_id,w.id,family);
  end if;
  update guest_waiver_sessions set waiver_id=w.id where id=s.id;
  return jsonb_build_object('waiver_id',w.id,'signed_at',w.signed_at,'expires_at',w.waiver_expires_at);
end $$;

create function public.claim_guest_waiver_family(p_user uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare verified_email text; family uuid; placeholder record;
begin
  select lower(trim(email)) into verified_email from auth.users where id=p_user and email_confirmed_at is not null;
  if verified_email is null then return jsonb_build_object('claimed',false); end if;
  perform pg_advisory_xact_lock(hashtext('guest-waiver-family:'||verified_email));
  select household_id into family from guest_waiver_identities where email=verified_email;
  if family is null then return jsonb_build_object('claimed',false); end if;
  -- Never switch an established account to another family silently.
  if exists(select 1 from household_members hm where hm.user_id=p_user and hm.household_id<>family
    and (exists(select 1 from people where household_id=hm.household_id)
      or exists(select 1 from party_bookings where household_id=hm.household_id)
      or exists(select 1 from memberships where household_id=hm.household_id))) then
    return jsonb_build_object('claimed',false,'review_required',true);
  end if;
  if exists(select 1 from household_members where user_id=p_user and household_id=family and role not in ('primary_caregiver','caregiver','owner','admin')) then
    return jsonb_build_object('claimed',false,'review_required',true);
  end if;
  insert into household_members(household_id,user_id,role) values(family,p_user,'primary_caregiver')
    on conflict(household_id,user_id) do update set created_at=now();
  -- Keep empty signup placeholders and history; only suppress their directory row.
  for placeholder in select hm.household_id from household_members hm join households h on h.id=hm.household_id
    where hm.user_id=p_user and hm.household_id<>family and h.name='My Household'
    and not exists(select 1 from household_members other where other.household_id=h.id and other.user_id<>p_user)
    and not exists(select 1 from people where household_id=h.id)
    and not exists(select 1 from party_bookings where household_id=h.id)
    and not exists(select 1 from memberships where household_id=h.id)
    and not exists(select 1 from waivers where household_id=h.id)
  loop
    insert into staff_family_search_aliases(alias_household_id,canonical_household_id,reason)
      values(placeholder.household_id,family,'Verified email linked the guest waiver family to its signup account') on conflict do nothing;
  end loop;
  return jsonb_build_object('claimed',true,'household_id',family);
end $$;

revoke all on function public.begin_guest_waiver(text,text,text,text,uuid),public.verify_guest_waiver(text,text),
  public.guest_waiver_household(text),public.guest_waiver_children(uuid),public.guest_waiver_context(text,text),public.use_guest_waiver(text,uuid,text),
  public.sign_guest_waiver(text,jsonb,jsonb,text,jsonb),public.claim_guest_waiver_family(uuid) from public,anon,authenticated;
grant execute on function public.begin_guest_waiver(text,text,text,text,uuid),public.verify_guest_waiver(text,text),
  public.guest_waiver_household(text),public.guest_waiver_children(uuid),public.guest_waiver_context(text,text),public.use_guest_waiver(text,uuid,text),
  public.sign_guest_waiver(text,jsonb,jsonb,text,jsonb),public.claim_guest_waiver_family(uuid) to service_role;
notify pgrst,'reload schema';
commit;
