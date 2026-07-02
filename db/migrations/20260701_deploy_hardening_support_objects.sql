begin;

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Staff-created walk-in households are not tied to an auth user until invited/claimed.
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'households'
      and column_name = 'user_id'
  ) then
    alter table public.households alter column user_id drop not null;
  elsif exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'households'
      and column_name = 'owner_user_id'
  ) then
    alter table public.households alter column owner_user_id drop not null;
  end if;
end
$$;

-- Audit/event tables should not be directly exposed to browser clients.
create table if not exists public.webhook_log (
  id uuid primary key default gen_random_uuid(),
  provider text,
  payload jsonb not null,
  received_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.webhook_log add column if not exists provider text;
alter table public.webhook_log add column if not exists payload jsonb;
alter table public.webhook_log add column if not exists received_at timestamptz default now();
alter table public.webhook_log add column if not exists updated_at timestamptz default now();
alter table public.webhook_log add column if not exists event_id text;
create unique index if not exists webhook_log_provider_event_id_key
  on public.webhook_log(provider, event_id)
  where event_id is not null;
alter table public.webhook_log enable row level security;

create table if not exists public.membership_events (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  membership_id uuid references public.memberships(id) on delete set null,
  action text not null,
  notes text,
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_by_role text,
  created_at timestamptz not null default now()
);

alter table public.membership_events add column if not exists household_id uuid references public.households(id) on delete cascade;
alter table public.membership_events add column if not exists membership_id uuid references public.memberships(id) on delete set null;
alter table public.membership_events add column if not exists action text;
alter table public.membership_events add column if not exists notes text;
alter table public.membership_events add column if not exists created_by_user_id uuid references auth.users(id) on delete set null;
alter table public.membership_events add column if not exists created_by_role text;
alter table public.membership_events add column if not exists created_at timestamptz not null default now();
create index if not exists idx_membership_events_household_id on public.membership_events(household_id, created_at desc);

alter table public.membership_events enable row level security;

drop policy if exists membership_events_staff_all on public.membership_events;
create policy membership_events_staff_all on public.membership_events
for all
using (
  exists (
    select 1 from public.roles r
    where r.id = auth.uid()
      and r.role in ('owner', 'staff', 'admin')
  )
)
with check (
  exists (
    select 1 from public.roles r
    where r.id = auth.uid()
      and r.role in ('owner', 'staff', 'admin')
  )
);

drop policy if exists membership_events_household_select on public.membership_events;
create policy membership_events_household_select on public.membership_events
for select
using (
  exists (
    select 1 from public.household_members hm
    where hm.household_id = membership_events.household_id
      and hm.user_id = auth.uid()
  )
);

-- Square customer mapping is server-managed only.
create table if not exists public.square_customers (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  square_customer_id text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.square_customers add column if not exists household_id uuid references public.households(id) on delete cascade;
alter table public.square_customers add column if not exists square_customer_id text;
alter table public.square_customers add column if not exists created_at timestamptz not null default now();
alter table public.square_customers add column if not exists updated_at timestamptz not null default now();
create index if not exists idx_square_customers_household_id on public.square_customers(household_id);
create unique index if not exists square_customers_square_customer_id_key on public.square_customers(square_customer_id);

drop trigger if exists set_updated_at_square_customers on public.square_customers;
create trigger set_updated_at_square_customers
before update on public.square_customers
for each row execute function public.set_updated_at();

alter table public.square_customers enable row level security;

-- Pricing rules are read by server routes. Staff can manage directly if needed.
create table if not exists public.pricing_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  min_months integer,
  max_months integer,
  price_cents integer not null,
  active_from date default current_date,
  active_to date,
  updated_at timestamptz default now()
);

alter table public.pricing_rules add column if not exists name text;
alter table public.pricing_rules add column if not exists min_months integer;
alter table public.pricing_rules add column if not exists max_months integer;
alter table public.pricing_rules add column if not exists price_cents integer not null default 0;
alter table public.pricing_rules add column if not exists active_from date default current_date;
alter table public.pricing_rules add column if not exists active_to date;
alter table public.pricing_rules add column if not exists updated_at timestamptz default now();
alter table public.pricing_rules enable row level security;

drop policy if exists pricing_rules_staff_all on public.pricing_rules;
create policy pricing_rules_staff_all on public.pricing_rules
for all
using (
  exists (
    select 1 from public.roles r
    where r.id = auth.uid()
      and r.role in ('owner', 'staff', 'admin')
  )
)
with check (
  exists (
    select 1 from public.roles r
    where r.id = auth.uid()
      and r.role in ('owner', 'staff', 'admin')
  )
);

create table if not exists public.occupancy_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  delta integer not null default 0,
  effective_date date not null default current_date,
  notes text,
  metadata jsonb default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.occupancy_events add column if not exists event_type text not null default 'manual_increment';
alter table public.occupancy_events add column if not exists delta integer not null default 0;
alter table public.occupancy_events add column if not exists effective_date date not null default current_date;
alter table public.occupancy_events add column if not exists notes text;
alter table public.occupancy_events add column if not exists metadata jsonb default '{}'::jsonb;
alter table public.occupancy_events add column if not exists created_by uuid references auth.users(id) on delete set null;
alter table public.occupancy_events add column if not exists created_at timestamptz default now();
alter table public.occupancy_events add column if not exists updated_at timestamptz default now();

alter table public.occupancy_events enable row level security;

drop policy if exists occupancy_events_staff_only on public.occupancy_events;
create policy occupancy_events_staff_only on public.occupancy_events
for all
using (
  exists (
    select 1 from public.roles r
    where r.id = auth.uid()
      and r.role in ('owner', 'staff', 'admin')
  )
)
with check (
  exists (
    select 1 from public.roles r
    where r.id = auth.uid()
      and r.role in ('owner', 'staff', 'admin')
  )
);

drop view if exists public.occupancy_status;
create view public.occupancy_status as
select
  current_date as effective_date,
  coalesce(sum(delta) filter (where event_type <> 'reset'), 0)::integer as current_occupancy,
  now() as calculated_at,
  max(created_at) as last_updated_at
from public.occupancy_events
where effective_date = current_date
  and created_at >= coalesce(
    (
      select max(created_at)
      from public.occupancy_events reset_events
      where reset_events.effective_date = current_date
        and reset_events.event_type = 'reset'
    ),
    current_date::timestamptz
  );

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.roles r
    where r.id = auth.uid()
      and r.role in ('owner', 'staff', 'admin')
  );
$$;

create or replace function public.record_checkin(p_group_size integer default 1)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.occupancy_events (event_type, delta, created_by)
  values ('checkin_increment', greatest(coalesce(p_group_size, 1), 1), auth.uid());
end;
$$;

create or replace function public.record_manual_increment(p_amount integer default 1)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.occupancy_events (event_type, delta, created_by)
  values ('manual_increment', greatest(coalesce(p_amount, 1), 1), auth.uid());
end;
$$;

create or replace function public.record_manual_decrement(p_amount integer default 1)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.occupancy_events (event_type, delta, created_by)
  values ('manual_decrement', -greatest(coalesce(p_amount, 1), 1), auth.uid());
end;
$$;

create or replace function public.reset_occupancy()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.occupancy_events (event_type, delta, created_by)
  values ('reset', 0, auth.uid());
end;
$$;

commit;
