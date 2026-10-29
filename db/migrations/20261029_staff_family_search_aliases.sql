begin;
-- Staff-directory overrides for duplicates explicitly identified by the family.
-- Preserve both accounts and all their bookings, waivers and financial history.
create table if not exists public.staff_family_search_aliases (
  alias_household_id uuid primary key references public.households(id) on delete cascade,
  canonical_household_id uuid not null references public.households(id) on delete restrict,
  reason text not null check (length(trim(reason)) > 0),
  created_at timestamptz not null default now(),
  check (alias_household_id <> canonical_household_id)
);
alter table public.staff_family_search_aliases enable row level security;
revoke all on public.staff_family_search_aliases from public, anon, authenticated;
grant all on public.staff_family_search_aliases to service_role;
notify pgrst, 'reload schema';
commit;
