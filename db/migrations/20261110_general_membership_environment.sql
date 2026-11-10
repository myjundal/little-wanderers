-- Already present in the live database; keep fresh installations consistent.
-- Leave historical rows unclassified until verified against their provider environment.
-- The production inventory on 2026-11-10 contained zero legacy memberships to backfill.
alter table public.memberships add column if not exists square_environment text
  check (square_environment in ('sandbox', 'production'));
