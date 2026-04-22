begin;

-- household_members must support walk-in family records without auth users.
alter table public.household_members
  alter column user_id drop not null;

alter table public.household_members
  add column if not exists full_name text,
  add column if not exists birth_date date,
  add column if not exists member_role text;

alter table public.household_members
  drop constraint if exists household_members_member_role_check;

alter table public.household_members
  add constraint household_members_member_role_check
  check (member_role is null or member_role in ('adult', 'child'));

commit;
