begin;

create table if not exists public.household_invites (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  email text not null,
  role text not null default 'member',
  status text not null default 'pending',
  invite_token uuid not null default gen_random_uuid(),
  invited_by uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint household_invites_role_check check (role in ('admin', 'member')),
  constraint household_invites_status_check check (status in ('pending', 'accepted', 'cancelled', 'expired')),
  constraint household_invites_email_check check (position('@' in email) > 1)
);

create index if not exists idx_household_invites_household_id on public.household_invites(household_id);
create index if not exists idx_household_invites_email on public.household_invites(lower(email));
create unique index if not exists idx_household_invites_pending_unique on public.household_invites(household_id, lower(email)) where status = 'pending';

drop trigger if exists set_updated_at_household_invites on public.household_invites;
create trigger set_updated_at_household_invites
before update on public.household_invites
for each row execute function public.set_updated_at();

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null,
  p256dh_key text not null,
  auth_key text not null,
  enabled boolean not null default true,
  last_notified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint push_subscriptions_endpoint_unique unique (endpoint)
);

create index if not exists idx_push_subscriptions_household_id on public.push_subscriptions(household_id);
create index if not exists idx_push_subscriptions_user_id on public.push_subscriptions(user_id);

drop trigger if exists set_updated_at_push_subscriptions on public.push_subscriptions;
create trigger set_updated_at_push_subscriptions
before update on public.push_subscriptions
for each row execute function public.set_updated_at();

alter table public.people enable row level security;
alter table public.party_bookings enable row level security;
alter table public.class_registrations enable row level security;
alter table public.checkins enable row level security;
alter table public.occupancy_events enable row level security;
alter table public.roles enable row level security;
alter table public.household_invites enable row level security;
alter table public.push_subscriptions enable row level security;

-- People: same-household read/write, owner/admin delete.
drop policy if exists people_select_household_member on public.people;
create policy people_select_household_member on public.people
for select
using (
  exists (
    select 1 from public.household_members hm
    where hm.household_id = people.household_id
      and hm.user_id = auth.uid()
  )
);

drop policy if exists people_insert_household_member on public.people;
create policy people_insert_household_member on public.people
for insert
with check (
  exists (
    select 1 from public.household_members hm
    where hm.household_id = people.household_id
      and hm.user_id = auth.uid()
  )
);

drop policy if exists people_update_household_member on public.people;
create policy people_update_household_member on public.people
for update
using (
  exists (
    select 1 from public.household_members hm
    where hm.household_id = people.household_id
      and hm.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.household_members hm
    where hm.household_id = people.household_id
      and hm.user_id = auth.uid()
  )
);

drop policy if exists people_delete_household_admin on public.people;
create policy people_delete_household_admin on public.people
for delete
using (
  exists (
    select 1 from public.household_members hm
    where hm.household_id = people.household_id
      and hm.user_id = auth.uid()
      and hm.role in ('owner', 'admin')
  )
);

-- Party bookings: same-household read/write.
drop policy if exists party_bookings_select_household_member on public.party_bookings;
create policy party_bookings_select_household_member on public.party_bookings
for select
using (
  exists (
    select 1 from public.household_members hm
    where hm.household_id = party_bookings.household_id
      and hm.user_id = auth.uid()
  )
);

drop policy if exists party_bookings_insert_household_member on public.party_bookings;
create policy party_bookings_insert_household_member on public.party_bookings
for insert
with check (
  exists (
    select 1 from public.household_members hm
    where hm.household_id = party_bookings.household_id
      and hm.user_id = auth.uid()
  )
);

drop policy if exists party_bookings_update_household_member on public.party_bookings;
create policy party_bookings_update_household_member on public.party_bookings
for update
using (
  exists (
    select 1 from public.household_members hm
    where hm.household_id = party_bookings.household_id
      and hm.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.household_members hm
    where hm.household_id = party_bookings.household_id
      and hm.user_id = auth.uid()
  )
);

-- Class registrations + checkins: scoped by related person's household membership.
drop policy if exists class_registrations_select_household_member on public.class_registrations;
create policy class_registrations_select_household_member on public.class_registrations
for select
using (
  exists (
    select 1
    from public.people p
    join public.household_members hm on hm.household_id = p.household_id
    where p.id = class_registrations.person_id
      and hm.user_id = auth.uid()
  )
);

drop policy if exists class_registrations_insert_household_member on public.class_registrations;
create policy class_registrations_insert_household_member on public.class_registrations
for insert
with check (
  exists (
    select 1
    from public.people p
    join public.household_members hm on hm.household_id = p.household_id
    where p.id = class_registrations.person_id
      and hm.user_id = auth.uid()
  )
);

drop policy if exists class_registrations_update_household_member on public.class_registrations;
create policy class_registrations_update_household_member on public.class_registrations
for update
using (
  exists (
    select 1
    from public.people p
    join public.household_members hm on hm.household_id = p.household_id
    where p.id = class_registrations.person_id
      and hm.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.people p
    join public.household_members hm on hm.household_id = p.household_id
    where p.id = class_registrations.person_id
      and hm.user_id = auth.uid()
  )
);

drop policy if exists checkins_select_household_member on public.checkins;
create policy checkins_select_household_member on public.checkins
for select
using (
  exists (
    select 1
    from public.people p
    join public.household_members hm on hm.household_id = p.household_id
    where p.id = checkins.person_id
      and hm.user_id = auth.uid()
  )
);

-- Owner/staff/admin tables.
drop policy if exists occupancy_events_staff_only on public.occupancy_events;
create policy occupancy_events_staff_only on public.occupancy_events
for all
using (
  exists (
    select 1 from public.roles r
    where r.id = auth.uid()
      and r.role in ('owner', 'staff', 'admin')
  )
)
with check (
  exists (
    select 1 from public.roles r
    where r.id = auth.uid()
      and r.role in ('owner', 'staff', 'admin')
  )
);

drop policy if exists roles_self_select on public.roles;
create policy roles_self_select on public.roles
for select
using (id = auth.uid());

-- Invite management: owner/admin in household.
drop policy if exists household_invites_select_household on public.household_invites;
create policy household_invites_select_household on public.household_invites
for select
using (
  exists (
    select 1 from public.household_members hm
    where hm.household_id = household_invites.household_id
      and hm.user_id = auth.uid()
  )
);

drop policy if exists household_invites_insert_admin on public.household_invites;
create policy household_invites_insert_admin on public.household_invites
for insert
with check (
  invited_by = auth.uid()
  and exists (
    select 1 from public.household_members hm
    where hm.household_id = household_invites.household_id
      and hm.user_id = auth.uid()
      and hm.role in ('owner', 'admin')
  )
);

drop policy if exists household_invites_update_admin on public.household_invites;
create policy household_invites_update_admin on public.household_invites
for update
using (
  exists (
    select 1 from public.household_members hm
    where hm.household_id = household_invites.household_id
      and hm.user_id = auth.uid()
      and hm.role in ('owner', 'admin')
  )
)
with check (
  exists (
    select 1 from public.household_members hm
    where hm.household_id = household_invites.household_id
      and hm.user_id = auth.uid()
      and hm.role in ('owner', 'admin')
  )
);

-- Push subscriptions: user manages own subscription rows, household-scoped read.
drop policy if exists push_subscriptions_select_household on public.push_subscriptions;
create policy push_subscriptions_select_household on public.push_subscriptions
for select
using (
  user_id = auth.uid()
  or exists (
    select 1 from public.household_members hm
    where hm.household_id = push_subscriptions.household_id
      and hm.user_id = auth.uid()
  )
);

drop policy if exists push_subscriptions_insert_self on public.push_subscriptions;
create policy push_subscriptions_insert_self on public.push_subscriptions
for insert
with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.household_members hm
    where hm.household_id = push_subscriptions.household_id
      and hm.user_id = auth.uid()
  )
);

drop policy if exists push_subscriptions_update_self on public.push_subscriptions;
create policy push_subscriptions_update_self on public.push_subscriptions
for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists push_subscriptions_delete_self on public.push_subscriptions;
create policy push_subscriptions_delete_self on public.push_subscriptions
for delete
using (user_id = auth.uid());

commit;
