begin;

alter table public.class_registrations
  add column if not exists household_id uuid references public.households(id) on delete set null,
  add column if not exists child_id uuid references public.people(id) on delete set null,
  add column if not exists created_by_user_id uuid references auth.users(id) on delete set null,
  add column if not exists created_by_role text;

alter table public.party_bookings
  add column if not exists child_id uuid references public.people(id) on delete set null,
  add column if not exists created_by_user_id uuid references auth.users(id) on delete set null,
  add column if not exists created_by_role text;

alter table public.checkins
  add column if not exists household_id uuid references public.households(id) on delete set null,
  add column if not exists child_id uuid references public.people(id) on delete set null,
  add column if not exists created_by_user_id uuid references auth.users(id) on delete set null,
  add column if not exists created_by_role text;

create index if not exists idx_class_registrations_household_id on public.class_registrations(household_id);
create index if not exists idx_checkins_household_id on public.checkins(household_id);

commit;
