create extension if not exists pgcrypto;

create table if not exists public.waivers (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  signed_at timestamptz,
  signed_date timestamptz,
  waiver_expires_at timestamptz,
  parent_name text,
  email text,
  phone text,
  child_1_name text,
  child_1_dob date,
  child_2_name text,
  child_2_dob date,
  child_3_name text,
  child_3_dob date,
  additional_children text,
  photo_consent text,
  electronic_signature text,
  source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.waivers add column if not exists household_id uuid references public.households(id) on delete cascade;
alter table public.waivers add column if not exists signed_at timestamptz;
alter table public.waivers add column if not exists signed_date timestamptz;
alter table public.waivers add column if not exists waiver_expires_at timestamptz;
alter table public.waivers add column if not exists parent_name text;
alter table public.waivers add column if not exists email text;
alter table public.waivers add column if not exists phone text;
alter table public.waivers add column if not exists child_1_name text;
alter table public.waivers add column if not exists child_1_dob date;
alter table public.waivers add column if not exists child_2_name text;
alter table public.waivers add column if not exists child_2_dob date;
alter table public.waivers add column if not exists child_3_name text;
alter table public.waivers add column if not exists child_3_dob date;
alter table public.waivers add column if not exists additional_children text;
alter table public.waivers add column if not exists photo_consent text;
alter table public.waivers add column if not exists electronic_signature text;
alter table public.waivers add column if not exists source text;
alter table public.waivers add column if not exists created_at timestamptz not null default now();
alter table public.waivers add column if not exists updated_at timestamptz not null default now();

create index if not exists waivers_household_id_idx on public.waivers(household_id);
create index if not exists waivers_household_signed_at_idx on public.waivers(household_id, signed_at desc);

create or replace function public.sync_waiver_expiration()
returns trigger
language plpgsql
as $$
begin
  if new.signed_at is null and new.signed_date is not null then
    new.signed_at = new.signed_date;
  end if;

  if new.signed_date is null and new.signed_at is not null then
    new.signed_date = new.signed_at;
  end if;

  if new.waiver_expires_at is null and new.signed_date is not null then
    new.waiver_expires_at = new.signed_date + interval '90 days';
  end if;

  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists waivers_set_expiration on public.waivers;
create trigger waivers_set_expiration
before insert or update on public.waivers
for each row execute function public.sync_waiver_expiration();

update public.waivers
set
  signed_at = coalesce(signed_at, signed_date),
  signed_date = coalesce(signed_date, signed_at),
  waiver_expires_at = coalesce(waiver_expires_at, coalesce(signed_date, signed_at) + interval '90 days')
where waiver_expires_at is null or signed_at is null or signed_date is null;
