begin;
-- Restore the table expected by the existing family invitation screens/API.
create table if not exists public.household_invites (
 id uuid primary key default gen_random_uuid(),
 household_id uuid not null references public.households(id) on delete cascade,
 email text not null,
 role text not null default 'member' check (role in ('caregiver','member')),
 status text not null default 'pending' check (status in ('pending','accepted','cancelled','expired')),
 invite_token uuid not null default gen_random_uuid(),
 invited_by uuid not null references auth.users(id) on delete cascade,
 expires_at timestamptz not null default (now() + interval '7 days'),
 accepted_at timestamptz,
 accepted_by_user_id uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create unique index if not exists household_invites_token_unique on public.household_invites(invite_token);
create unique index if not exists idx_household_invites_pending_unique on public.household_invites(household_id,lower(email)) where status = 'pending';
create index if not exists idx_household_invites_household_id on public.household_invites(household_id);
alter table public.household_invites enable row level security;
revoke all on public.household_invites from anon, authenticated;
grant select, insert on public.household_invites to authenticated;
grant all on public.household_invites to service_role;
drop policy if exists household_invites_select_household on public.household_invites;
create policy household_invites_select_household on public.household_invites for select to authenticated
using (exists (select 1 from public.household_members hm where hm.household_id = household_invites.household_id and hm.user_id = auth.uid()));
drop policy if exists household_invites_insert_admin on public.household_invites;
create policy household_invites_insert_admin on public.household_invites for insert to authenticated
with check (invited_by = auth.uid() and status = 'pending' and accepted_at is null and accepted_by_user_id is null
 and exists (select 1 from public.household_members hm where hm.household_id = household_invites.household_id and hm.user_id = auth.uid() and hm.role in ('primary_caregiver','caregiver','owner','admin')));
commit;
