begin;

create table if not exists public.membership_events (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  membership_id uuid references public.memberships(id) on delete set null,
  action text not null,
  notes text,
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_by_role text,
  created_at timestamptz not null default now()
);

create index if not exists idx_membership_events_household_id on public.membership_events(household_id, created_at desc);

commit;
