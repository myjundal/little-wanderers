begin;

alter table public.people
  add column if not exists gender text;

alter table public.people
  drop constraint if exists people_gender_check;

alter table public.people
  add constraint people_gender_check
  check (gender is null or gender in ('female', 'male', 'non_binary', 'prefer_not_to_say'));

alter table public.households
  add column if not exists email text;

alter table public.waivers enable row level security;

drop policy if exists waivers_select_household_member on public.waivers;
create policy waivers_select_household_member on public.waivers
for select
using (
  exists (
    select 1 from public.household_members hm
    where hm.household_id = waivers.household_id
      and hm.user_id = auth.uid()
  )
);

drop policy if exists waivers_insert_household_member on public.waivers;
create policy waivers_insert_household_member on public.waivers
for insert
with check (
  exists (
    select 1 from public.household_members hm
    where hm.household_id = waivers.household_id
      and hm.user_id = auth.uid()
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
      and hm.role in ('owner', 'admin')
  )
)
with check (
  exists (
    select 1 from public.household_members hm
    where hm.household_id = waivers.household_id
      and hm.user_id = auth.uid()
      and hm.role in ('owner', 'admin')
  )
);

commit;
