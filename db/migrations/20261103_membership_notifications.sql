begin;

-- Private, durable owner-email queue. No card/provider credentials are included.
create table public.membership_notification_outbox (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  household_id uuid not null references public.households(id),
  payload jsonb not null,
  created_at timestamptz not null default now(),
  next_attempt_at timestamptz not null default now(),
  attempts integer not null default 0,
  sent_at timestamptz
);
alter table public.membership_notification_outbox enable row level security;
revoke all on public.membership_notification_outbox from anon,authenticated;
grant all on public.membership_notification_outbox to service_role;

create function public.queue_membership_notification() returns trigger
language plpgsql security definer set search_path=public as $$
declare details jsonb; children jsonb; notification_key text; family_id uuid; profile jsonb;
begin
  family_id:=new.household_id;
  if tg_table_name='founding_memberships' then
    if new.environment<>'production' or new.status<>'pending' then return new; end if;
    if tg_op='UPDATE' and old.status='pending' then return new; end if;
    notification_key:='founding/'||new.id;
    profile:=new.profile_snapshot;
    select jsonb_agg(jsonb_build_object('firstName',c->>'firstName','lastName',c->>'lastName','birthdate',c->>'birthdate')) into children from jsonb_array_elements(profile->'children') c;
    details:=jsonb_build_object('tier',new.pricing_tier,'event','Card saved; no payment taken',
      'familyName',(profile->>'adultLastName')||' Family','guardianName',concat_ws(' ',profile->>'adultFirstName',profile->>'adultLastName'),
      'email',profile->>'email','phone',profile->>'phone','baseCents',new.base_cents,'siblingCents',new.sibling_cents,'amountCents',new.amount_cents);
  else
    if to_jsonb(new)->>'square_environment'='sandbox' then return new; end if;
    if new.renews_at is null or new.renews_at<=now() then return new; end if;
    if tg_op='UPDATE' and old.renews_at>now() then return new; end if;
    notification_key:='regular/'||new.id||'/'||new.renews_at;
    select jsonb_agg(jsonb_build_object('firstName',p.first_name,'lastName',p.last_name,'birthdate',p.birthdate) order by p.created_at) into children from people p where p.household_id=family_id and p.role='child';
    select jsonb_build_object('tier','regular','event','Membership started','familyName',h.name,'email',h.email,'phone',h.phone,
      'guardianName',(select concat_ws(' ',p.first_name,p.last_name) from people p where p.household_id=family_id and p.role='adult' order by p.created_at limit 1)) into details from households h where h.id=family_id;
  end if;
  insert into membership_notification_outbox(event_key,household_id,payload)
    values(notification_key,family_id,details||jsonb_build_object('children',coalesce(children,'[]'::jsonb),'occurredAt',now()))
    on conflict(event_key) do nothing;
  return new;
end;
$$;
revoke all on function public.queue_membership_notification() from public,anon,authenticated;
create trigger founding_membership_owner_alert after insert or update on public.founding_memberships for each row execute function public.queue_membership_notification();
create trigger regular_membership_owner_alert after insert or update on public.memberships for each row execute function public.queue_membership_notification();

create function public.lease_membership_notification(p_id uuid) returns public.membership_notification_outbox
language sql security definer set search_path=public as $$
  update membership_notification_outbox set attempts=attempts+1,next_attempt_at=now()+interval '10 minutes'
    where id=p_id and sent_at is null and next_attempt_at<=now() returning *;
$$;
revoke all on function public.lease_membership_notification(uuid) from public,anon,authenticated;
grant execute on function public.lease_membership_notification(uuid) to service_role;
notify pgrst,'reload schema';
commit;
