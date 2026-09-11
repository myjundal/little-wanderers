begin;

insert into public.open_play_reservation_slots (
  label,
  starts_at,
  ends_at,
  capacity_children,
  capacity_total,
  status,
  notes,
  is_soft_opening
)
select
  'Soft Opening Open Play',
  (day::date + window_start::time) at time zone 'America/New_York',
  (day::date + window_end::time) at time zone 'America/New_York',
  8,
  null,
  'open',
  'Two-hour arrival window. Families may arrive any time during the window and stay beyond the window as capacity allows.',
  true
from generate_series(date '2026-10-15', date '2026-10-31', interval '1 day') as days(day)
cross join (
  values
    ('09:00'::time, '11:00'::time),
    ('11:00'::time, '13:00'::time),
    ('13:00'::time, '15:00'::time),
    ('15:00'::time, '17:00'::time)
) as windows(window_start, window_end)
where not exists (
  select 1
  from public.open_play_reservation_slots existing
  where existing.is_soft_opening = true
    and existing.starts_at = (day::date + window_start::time) at time zone 'America/New_York'
    and existing.ends_at = (day::date + window_end::time) at time zone 'America/New_York'
);

commit;
