begin;

alter table public.memberships enable row level security;

-- Household members can read household-owned memberships, and person memberships for people in their household.
drop policy if exists memberships_select_household_member on public.memberships;
create policy memberships_select_household_member on public.memberships
for select
using (
  exists (
    select 1
    from public.household_members hm
    where hm.user_id = auth.uid()
      and (
        (memberships.household_id is not null and hm.household_id = memberships.household_id)
        or (
          memberships.person_id is not null
          and exists (
            select 1
            from public.people p
            where p.id = memberships.person_id
              and p.household_id = hm.household_id
          )
        )
      )
  )
);

-- Owner/admin can manage household-owned membership rows.
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
      and hm.role in ('owner','admin')
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
      and hm.role in ('owner','admin')
  )
)
with check (
  memberships.household_id is not null
  and exists (
    select 1
    from public.household_members hm
    where hm.user_id = auth.uid()
      and hm.household_id = memberships.household_id
      and hm.role in ('owner','admin')
  )
);

commit;
