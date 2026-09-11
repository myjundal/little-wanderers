begin;

create table if not exists public.open_play_reservation_slots (
  id uuid primary key default gen_random_uuid(),
  label text not null default 'Open Play',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  capacity_children integer not null default 8,
  capacity_total integer,
  status text not null default 'open',
  notes text,
  is_soft_opening boolean not null default true,
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint open_play_reservation_slots_time_check check (ends_at > starts_at),
  constraint open_play_reservation_slots_capacity_children_check check (capacity_children > 0),
  constraint open_play_reservation_slots_capacity_total_check check (capacity_total is null or capacity_total > 0),
  constraint open_play_reservation_slots_status_check check (status in ('open', 'hidden', 'closed'))
);

create table if not exists public.open_play_reservations (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null references public.open_play_reservation_slots(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  created_by_user_id uuid references auth.users(id) on delete set null,
  contact_email text,
  child_count integer not null default 1,
  adult_count integer not null default 1,
  notes text,
  status text not null default 'reserved',
  cancelled_at timestamptz,
  cancelled_by_user_id uuid references auth.users(id) on delete set null,
  status_updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint open_play_reservations_child_count_check check (child_count > 0),
  constraint open_play_reservations_adult_count_check check (adult_count > 0),
  constraint open_play_reservations_status_check check (status in ('reserved', 'cancelled', 'checked_in', 'no_show'))
);

create index if not exists idx_open_play_reservation_slots_starts_at
  on public.open_play_reservation_slots(starts_at);

create index if not exists idx_open_play_reservation_slots_status
  on public.open_play_reservation_slots(status);

create index if not exists idx_open_play_reservations_slot_id
  on public.open_play_reservations(slot_id);

create index if not exists idx_open_play_reservations_household_id
  on public.open_play_reservations(household_id);

create unique index if not exists open_play_reservations_one_active_per_household_slot
  on public.open_play_reservations(slot_id, household_id)
  where status <> 'cancelled';

drop trigger if exists set_updated_at_open_play_reservation_slots on public.open_play_reservation_slots;
create trigger set_updated_at_open_play_reservation_slots
before update on public.open_play_reservation_slots
for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at_open_play_reservations on public.open_play_reservations;
create trigger set_updated_at_open_play_reservations
before update on public.open_play_reservations
for each row execute function public.set_updated_at();

alter table public.open_play_reservation_slots enable row level security;
alter table public.open_play_reservations enable row level security;

commit;
