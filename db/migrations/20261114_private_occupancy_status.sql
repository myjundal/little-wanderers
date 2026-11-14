begin;
-- Staff routes authorize the operator, then read this aggregate with the service role.
-- Public callers receive only the coarse messages from /api/crowd-level.
revoke all on table public.occupancy_status from public, anon, authenticated;
grant select on table public.occupancy_status to service_role;
commit;
