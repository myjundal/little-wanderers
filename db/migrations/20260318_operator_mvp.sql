create table if not exists public.occupancy_events (
    id uuid default gen_random_uuid() not null,
    event_type text not null,
    delta integer not null default 0,
    effective_date date not null default current_date,
    notes text,
    metadata jsonb default '{}'::jsonb,
    created_by uuid,
    created_at timestamp with time zone default now(),
    updated_at timestamp with time zone default now()
);

alter table public.occupancy_events add primary key (id);

alter table public.occupancy_events
  add constraint occupancy_events_created_by_fkey
  foreign key (created_by) references auth.users(id) on delete set null;

alter table public.occupancy_events
  add constraint occupancy_events_event_type_check
  check (event_type in ('checkin_increment', 'manual_increment', 'manual_decrement', 'reset'));

alter table public.classes add column if not exists duration_minutes integer;
alter table public.classes add column if not exists instructor_name text;
alter table public.classes add column if not exists description text;

alter table public.classes
  add constraint classes_duration_minutes_check
  check (duration_minutes is null or duration_minutes > 0);

alter table public.party_bookings add column if not exists status text default 'pending';
alter table public.party_bookings add column if not exists status_updated_at timestamp with time zone default now();

alter table public.party_bookings
  add constraint party_bookings_status_check
  check (status in ('pending', 'confirmed', 'cancelled'));

alter table public.party_bookings
  alter column status set default 'pending';

create index if not exists idx_occupancy_events_effective_date on public.occupancy_events(effective_date);
create index if not exists idx_occupancy_events_created_at on public.occupancy_events(created_at desc);
create index if not exists idx_party_bookings_status on public.party_bookings(status);

update public.classes
set duration_minutes = greatest(round(extract(epoch from (end_time - start_time)) / 60.0)::integer, 1)
where duration_minutes is null;

update public.party_bookings
set status = coalesce(status, 'pending'),
    status_updated_at = coalesce(status_updated_at, created_at, now());

drop trigger if exists set_updated_at_occupancy_events on public.occupancy_events;
create trigger set_updated_at_occupancy_events
before update on public.occupancy_events
for each row execute function public.set_updated_at();

