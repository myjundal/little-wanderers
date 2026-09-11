begin;

alter table public.open_play_reservation_slots
  alter column capacity_children set default 10;

update public.open_play_reservation_slots
set capacity_children = 10
where is_soft_opening = true
  and starts_at >= timestamptz '2026-10-15 00:00:00 America/New_York'
  and starts_at < timestamptz '2026-11-01 00:00:00 America/New_York';

commit;
