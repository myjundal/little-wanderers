alter table public.households
  add column if not exists city text,
  add column if not exists state text;
