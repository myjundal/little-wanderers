alter table public.classes
add column if not exists duration_minutes integer,
add column if not exists instructor_name text,
add column if not exists description text,
add column if not exists age_range text,
add column if not exists caregiver_participation text,
add column if not exists schedule_note text,
add column if not exists schedule_label text;

alter table public.classes
drop constraint if exists classes_duration_minutes_check;

alter table public.classes
add constraint classes_duration_minutes_check
check (duration_minutes is null or duration_minutes > 0);

update public.classes
set duration_minutes = greatest(round(extract(epoch from (end_time - start_time)) / 60.0)::integer, 1)
where duration_minutes is null;
