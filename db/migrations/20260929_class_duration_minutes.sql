alter table public.classes
add column if not exists duration_minutes integer;

alter table public.classes
drop constraint if exists classes_duration_minutes_check;

alter table public.classes
add constraint classes_duration_minutes_check
check (duration_minutes is null or duration_minutes > 0);

update public.classes
set duration_minutes = greatest(round(extract(epoch from (end_time - start_time)) / 60.0)::integer, 1)
where duration_minutes is null;
