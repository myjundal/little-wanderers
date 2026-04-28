-- Class attendance tracking
alter table public.class_registrations
  add column if not exists attendance_status text not null default 'unknown',
  add column if not exists attendance_marked_at timestamptz,
  add column if not exists attendance_marked_by uuid,
  add column if not exists customer_favorite boolean not null default false,
  add column if not exists customer_note text,
  add column if not exists customer_note_updated_at timestamptz;

alter table public.class_registrations
  drop constraint if exists class_registrations_attendance_status_check;

alter table public.class_registrations
  add constraint class_registrations_attendance_status_check
  check (attendance_status in ('unknown', 'attended', 'cancelled', 'no_show'));

alter table public.class_registrations
  drop constraint if exists class_registrations_attendance_marked_by_fkey;

alter table public.class_registrations
  add constraint class_registrations_attendance_marked_by_fkey
  foreign key (attendance_marked_by) references auth.users(id) on delete set null;

create index if not exists idx_class_registrations_attendance_status
  on public.class_registrations(attendance_status);

-- Party attendance tracking
alter table public.party_bookings
  add column if not exists current_child_count integer not null default 0,
  add column if not exists current_adult_count integer not null default 0,
  add column if not exists final_child_count integer,
  add column if not exists final_adult_count integer,
  add column if not exists final_total_count integer,
  add column if not exists attendance_finalized_at timestamptz,
  add column if not exists attendance_recorded_by uuid,
  add column if not exists attendance_notes text;

alter table public.party_bookings
  drop constraint if exists party_bookings_current_child_count_check,
  drop constraint if exists party_bookings_current_adult_count_check,
  drop constraint if exists party_bookings_final_child_count_check,
  drop constraint if exists party_bookings_final_adult_count_check,
  drop constraint if exists party_bookings_final_total_count_check;

alter table public.party_bookings
  add constraint party_bookings_current_child_count_check check (current_child_count >= 0),
  add constraint party_bookings_current_adult_count_check check (current_adult_count >= 0),
  add constraint party_bookings_final_child_count_check check (final_child_count is null or final_child_count >= 0),
  add constraint party_bookings_final_adult_count_check check (final_adult_count is null or final_adult_count >= 0),
  add constraint party_bookings_final_total_count_check check (final_total_count is null or final_total_count >= 0);

alter table public.party_bookings
  drop constraint if exists party_bookings_attendance_recorded_by_fkey;

alter table public.party_bookings
  add constraint party_bookings_attendance_recorded_by_fkey
  foreign key (attendance_recorded_by) references auth.users(id) on delete set null;

create index if not exists idx_party_bookings_attendance_finalized_at
  on public.party_bookings(attendance_finalized_at);
