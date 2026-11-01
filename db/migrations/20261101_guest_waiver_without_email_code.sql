begin;

-- Contact details on a paper-style waiver are self-reported, not an account identity.
create table public.guest_waiver_submissions (
  token_hash text primary key check (length(token_hash)=64),
  request_hash text not null check (length(request_hash)=64),
  email text not null,
  ip_hash text not null check (length(ip_hash)=64),
  party_booking_id uuid references public.party_bookings(id) on delete restrict,
  waiver_id uuid not null references public.waivers(id) on delete restrict,
  created_at timestamptz not null default now(),
  receipt_expires_at timestamptz not null default now()+interval '2 hours'
);
create index guest_waiver_submissions_ip_created on public.guest_waiver_submissions(ip_hash,created_at);
create index guest_waiver_submissions_email_created on public.guest_waiver_submissions(email,created_at);
alter table public.guest_waiver_submissions enable row level security;
revoke all on public.guest_waiver_submissions from public,anon,authenticated;
grant all on public.guest_waiver_submissions to service_role;

create function public.submit_guest_waiver(
  p_token_hash text,p_request_hash text,p_email text,p_ip_hash text,p_party uuid,
  p_profile jsonb,p_version text,p_snapshot jsonb
) returns jsonb language plpgsql security definer set search_path=public as $$
declare previous guest_waiver_submissions; family uuid; child jsonb; child_id uuid;
  children jsonb:='[]'::jsonb; child_ids uuid[]:='{}'::uuid[]; w waivers;
  signature text:=trim(p_profile->>'signature');
begin
  if p_token_hash is null or length(p_token_hash)<>64 or p_request_hash is null or length(p_request_hash)<>64
    or p_ip_hash is null or length(p_ip_hash)<>64 or p_email is null or p_email<>lower(trim(p_email))
    or length(p_email)>254 or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Invalid waiver request';
  end if;
  perform pg_advisory_xact_lock(hashtext('guest-waiver-submission:'||p_token_hash));
  select * into previous from guest_waiver_submissions where token_hash=p_token_hash;
  if found then
    if previous.request_hash<>p_request_hash or previous.receipt_expires_at<=now() then
      return jsonb_build_object('ok',false,'code','start_new_waiver');
    end if;
    select * into w from waivers where id=previous.waiver_id;
    return jsonb_build_object('ok',true,'waiver_id',w.id,'signed_at',w.signed_at,'expires_at',w.waiver_expires_at);
  end if;
  perform pg_advisory_xact_lock(hashtext('guest-waiver-direct-rate:'||p_ip_hash));
  perform pg_advisory_xact_lock(hashtext('guest-waiver-direct-email:'||p_email));
  if (select count(*) from guest_waiver_submissions where ip_hash=p_ip_hash and created_at>now()-interval '15 minutes')>=120
    or (select count(*) from guest_waiver_submissions where email=p_email and created_at>now()-interval '15 minutes')>=10 then
    return jsonb_build_object('ok',false,'code','rate_limited');
  end if;
  if p_party is not null and not exists(select 1 from party_bookings where id=p_party and status in ('confirmed','early_access_hold')) then
    return jsonb_build_object('ok',false,'code','party_unavailable');
  end if;
  if coalesce(length(signature),0) not between 2 and 150
    or coalesce(length(trim(p_profile->>'first_name')),0) not between 1 and 100
    or coalesce(length(trim(p_profile->>'last_name')),0) not between 1 and 100
    or coalesce(p_profile->>'phone','') !~ '^\+[1-9][0-9]{7,14}$'
    or coalesce(jsonb_typeof(p_profile->'children'),'')<>'array'
    or jsonb_array_length(p_profile->'children') not between 1 and 10
    or p_snapshot->>'is_guardian' is distinct from 'true'
    or p_snapshot->>'electronic_consent' is distinct from 'true'
    or coalesce(jsonb_typeof(p_profile->'photo_consent'),'')<>'boolean'
    or coalesce(length(p_version),0)<1 then raise exception 'Complete all required waiver fields';
  end if;
  -- Never find, modify, or claim an existing family using an unverified email.
  insert into households(name,email,phone,role)
    values(trim(p_profile->>'last_name')||' Family',p_email,p_profile->>'phone','primary_caregiver') returning id into family;
  insert into people(household_id,role,first_name,last_name)
    values(family,'adult',trim(p_profile->>'first_name'),trim(p_profile->>'last_name'));
  for child in select value from jsonb_array_elements(p_profile->'children') loop
    if coalesce(length(trim(child->>'first_name')),0) not between 1 and 100
      or coalesce(length(trim(child->>'last_name')),0) not between 1 and 100
      or child->>'birthdate' is null or (child->>'birthdate')::date>current_date
      or (child->>'birthdate')::date<'1900-01-01'::date then raise exception 'Enter a valid child name and birthday'; end if;
    if exists(select 1 from people where household_id=family and role='child'
      and lower(first_name)=lower(trim(child->>'first_name')) and lower(last_name)=lower(trim(child->>'last_name'))
      and birthdate=(child->>'birthdate')::date) then raise exception 'List each child once'; end if;
    insert into people(household_id,role,first_name,last_name,birthdate)
      values(family,'child',trim(child->>'first_name'),trim(child->>'last_name'),(child->>'birthdate')::date) returning id into child_id;
    child_ids:=array_append(child_ids,child_id);
    children:=children||jsonb_build_array(jsonb_build_object('id',child_id,'first_name',trim(child->>'first_name'),
      'last_name',trim(child->>'last_name'),'birthdate',child->>'birthdate'));
  end loop;
  insert into waivers(household_id,signed_at,signed_date,waiver_expires_at,parent_name,electronic_signature,email,phone,photo_consent,source,waiver_version,covered_person_ids,agreement_snapshot)
    values(family,now(),now(),now()+interval '90 days',signature,signature,p_email,p_profile->>'phone',
      (p_profile->>'photo_consent')::boolean,'guest_website',p_version,child_ids,
      (p_snapshot-'verified_email'-'email_verified_at')||jsonb_build_object('children',children,'submitted_email',p_email,'email_verified',false)) returning * into w;
  if p_party is not null then
    insert into party_guest_waivers(party_booking_id,waiver_id,household_id) values(p_party,w.id,family);
  end if;
  insert into guest_waiver_submissions(token_hash,request_hash,email,ip_hash,party_booking_id,waiver_id)
    values(p_token_hash,p_request_hash,p_email,p_ip_hash,p_party,w.id);
  return jsonb_build_object('ok',true,'waiver_id',w.id,'signed_at',w.signed_at,'expires_at',w.waiver_expires_at);
end $$;

revoke all on function public.submit_guest_waiver(text,text,text,text,uuid,jsonb,text,jsonb) from public,anon,authenticated;
grant execute on function public.submit_guest_waiver(text,text,text,text,uuid,jsonb,text,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
