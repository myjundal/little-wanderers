begin;

-- Keep app-level public.roles.owner for real operator access.
-- Rename family-account roles so Supabase rows do not look like staff access.
alter table public.households
  drop constraint if exists households_role_check;

alter table public.household_members
  drop constraint if exists household_members_role_check;

alter table public.household_invites
  drop constraint if exists household_invites_role_check;

update public.households
set role = case
  when role = 'owner' then 'primary_caregiver'
  when role = 'admin' then 'caregiver'
  else role
end
where role in ('owner', 'admin');

update public.household_members
set role = case
  when role = 'owner' then 'primary_caregiver'
  when role = 'admin' then 'caregiver'
  else role
end
where role in ('owner', 'admin');

update public.household_invites
set role = 'caregiver'
where role = 'admin';

alter table public.households
  add constraint households_role_check
  check (role in ('primary_caregiver', 'caregiver', 'member', 'owner', 'admin'));

alter table public.household_members
  add constraint household_members_role_check
  check (role in ('primary_caregiver', 'caregiver', 'member', 'owner', 'admin'));

alter table public.household_invites
  add constraint household_invites_role_check
  check (role in ('caregiver', 'member', 'admin'));

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _household_id uuid;
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'households'
      and column_name = 'user_id'
  ) then
    execute
      'insert into public.households (user_id, role, name, email)
       values ($1, $2, $3, $4)
       returning id'
      using new.id, 'primary_caregiver', 'My Household', new.email
      into _household_id;
  else
    insert into public.households (role, name, email)
    values ('primary_caregiver', 'My Household', new.email)
    returning id into _household_id;
  end if;

  insert into public.household_members (household_id, user_id, role)
  values (_household_id, new.id, 'primary_caregiver')
  on conflict (household_id, user_id) do nothing;

  insert into public.roles (id, role)
  values (new.id, 'user')
  on conflict (id) do nothing;

  return new;
end;
$$;

drop policy if exists households_update_owner on public.households;
create policy households_update_owner on public.households
for update
using (
  exists (
    select 1
    from public.household_members hm
    where hm.household_id = households.id
      and hm.user_id = auth.uid()
      and hm.role in ('primary_caregiver', 'caregiver', 'owner', 'admin')
  )
)
with check (
  exists (
    select 1
    from public.household_members hm
    where hm.household_id = households.id
      and hm.user_id = auth.uid()
      and hm.role in ('primary_caregiver', 'caregiver', 'owner', 'admin')
  )
);

drop policy if exists household_members_insert_owner_admin on public.household_members;
create policy household_members_insert_owner_admin on public.household_members
for insert
with check (
  user_id = auth.uid()
  or exists (
    select 1
    from public.household_members mine
    where mine.household_id = household_members.household_id
      and mine.user_id = auth.uid()
      and mine.role in ('primary_caregiver', 'caregiver', 'owner', 'admin')
  )
);

drop policy if exists household_members_update_owner_admin on public.household_members;
create policy household_members_update_owner_admin on public.household_members
for update
using (
  exists (
    select 1
    from public.household_members mine
    where mine.household_id = household_members.household_id
      and mine.user_id = auth.uid()
      and mine.role in ('primary_caregiver', 'caregiver', 'owner', 'admin')
  )
)
with check (
  exists (
    select 1
    from public.household_members mine
    where mine.household_id = household_members.household_id
      and mine.user_id = auth.uid()
      and mine.role in ('primary_caregiver', 'caregiver', 'owner', 'admin')
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
      and hm.role in ('primary_caregiver', 'caregiver', 'owner', 'admin')
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
      and hm.role in ('primary_caregiver', 'caregiver', 'owner', 'admin')
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
      and hm.role in ('primary_caregiver', 'caregiver', 'owner', 'admin')
  )
)
with check (
  exists (
    select 1 from public.household_members hm
    where hm.household_id = household_invites.household_id
      and hm.user_id = auth.uid()
      and hm.role in ('primary_caregiver', 'caregiver', 'owner', 'admin')
  )
);

drop policy if exists memberships_insert_household_admin on public.memberships;
create policy memberships_insert_household_admin on public.memberships
for insert
with check (
  memberships.household_id is not null
  and exists (
    select 1
    from public.household_members hm
    where hm.user_id = auth.uid()
      and hm.household_id = memberships.household_id
      and hm.role in ('primary_caregiver', 'caregiver', 'owner', 'admin')
  )
);

drop policy if exists memberships_update_household_admin on public.memberships;
create policy memberships_update_household_admin on public.memberships
for update
using (
  memberships.household_id is not null
  and exists (
    select 1
    from public.household_members hm
    where hm.user_id = auth.uid()
      and hm.household_id = memberships.household_id
      and hm.role in ('primary_caregiver', 'caregiver', 'owner', 'admin')
  )
)
with check (
  memberships.household_id is not null
  and exists (
    select 1
    from public.household_members hm
    where hm.user_id = auth.uid()
      and hm.household_id = memberships.household_id
      and hm.role in ('primary_caregiver', 'caregiver', 'owner', 'admin')
  )
);

drop policy if exists waivers_update_household_admin on public.waivers;
create policy waivers_update_household_admin on public.waivers
for update
using (
  exists (
    select 1 from public.household_members hm
    where hm.household_id = waivers.household_id
      and hm.user_id = auth.uid()
      and hm.role in ('primary_caregiver', 'caregiver', 'owner', 'admin')
  )
)
with check (
  exists (
    select 1 from public.household_members hm
    where hm.household_id = waivers.household_id
      and hm.user_id = auth.uid()
      and hm.role in ('primary_caregiver', 'caregiver', 'owner', 'admin')
  )
);

commit;
