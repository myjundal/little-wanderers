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

create table if not exists public.party_booking_events (
    id uuid default gen_random_uuid() not null,
    party_booking_id uuid not null,
    from_status text,
    to_status text not null,
    notes text,
    changed_by uuid,
    created_at timestamp with time zone default now(),
    updated_at timestamp with time zone default now()
);

alter table public.party_booking_events add primary key (id);

alter table public.party_booking_events
  add constraint party_booking_events_party_booking_id_fkey
  foreign key (party_booking_id) references public.party_bookings(id) on delete cascade;

alter table public.party_booking_events
  add constraint party_booking_events_changed_by_fkey
  foreign key (changed_by) references auth.users(id) on delete set null;

alter table public.party_booking_events
  add constraint party_booking_events_to_status_check
  check (to_status in ('pending', 'confirmed', 'cancelled'));

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
create index if not exists idx_party_booking_events_booking_id on public.party_booking_events(party_booking_id);
create index if not exists idx_party_bookings_status on public.party_bookings(status);

update public.classes
set duration_minutes = greatest(round(extract(epoch from (end_time - start_time)) / 60.0)::integer, 1)
where duration_minutes is null;

update public.party_bookings
set status = coalesce(status, 'pending'),
    status_updated_at = coalesce(status_updated_at, created_at, now());

insert into public.party_booking_events (party_booking_id, from_status, to_status, notes, created_at, updated_at)
select id, null, status, 'Backfilled existing booking status', coalesce(status_updated_at, created_at, now()), coalesce(status_updated_at, created_at, now())
from public.party_bookings pb
where not exists (
  select 1 from public.party_booking_events pbe where pbe.party_booking_id = pb.id
);

drop trigger if exists set_updated_at_occupancy_events on public.occupancy_events;
create trigger set_updated_at_occupancy_events
before update on public.occupancy_events
for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at_party_booking_events on public.party_booking_events;
create trigger set_updated_at_party_booking_events
before update on public.party_booking_events
for each row execute function public.set_updated_at();
