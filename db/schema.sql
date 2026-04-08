CREATE TABLE public.catalog_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider text DEFAULT 'square'::text,
    external_item_id text NOT NULL,
    name text,
    price_cents integer,
    metadata jsonb
);

CREATE TABLE public.checkins (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    person_id uuid NOT NULL,
    checked_in_at timestamp with time zone DEFAULT now(),
    source text,
    price_cents integer DEFAULT 0 NOT NULL,
    membership_applied boolean DEFAULT false,  
    notes text
);

CREATE TABLE public.class_registrations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    class_id uuid NOT NULL,
    person_id uuid NOT NULL,
    status text DEFAULT 'scheduled'::text,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.classes (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    category text,
    age_range text,
    start_time timestamp with time zone NOT NULL,
    end_time timestamp with time zone NOT NULL,
    capacity integer,
    price_cents integer DEFAULT 0 NOT NULL,
    external_id text,
    status text DEFAULT 'scheduled'::text
);

CREATE TABLE public.households (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    role text NOT NULL DEFAULT 'owner'::text,
    name text,
    phone text,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.household_members (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    household_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text NOT NULL DEFAULT 'owner'::text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.memberships (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    household_id uuid,
    person_id uuid,
    square_customer_id text,
    square_subscription_id text,
    renews_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT memberships_check CHECK ((((household_id IS NOT NULL) AND (person_id IS NULL))))
);

CREATE TABLE public.party_bookings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    household_id uuid NOT NULL,
    start_time timestamp with time zone NOT NULL,
    end_time timestamp with time zone NOT NULL,
    room text,
    headcount_expected integer,
    price_quote_cents integer,
    external_id text,  
    notes text,
    created_at timestamp with time zone DEFAULT now() 
);

CREATE TABLE public.people (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    household_id uuid NOT NULL,
    first_name text NOT NULL,
    last_name text,
    birthdate date,
    notes text,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.pricing_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    min_months integer,
    max_months integer,
    price_cents integer NOT NULL,
    active_from date DEFAULT CURRENT_DATE,
    active_to date
);

CREATE TABLE public.roles (
     id uuid NOT NULL,
    role text DEFAULT 'user'::text
);

CREATE TABLE public.webhook_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider text,
    payload jsonb NOT NULL,
    received_at timestamp with time zone DEFAULT now()
);

-- =========================================
-- PRIMARY KEYS
-- =========================================
alter table public.catalog_items add primary key (id);
alter table public.checkins add primary key (id);
alter table public.class_registrations add primary key (id);
alter table public.classes add primary key (id);
alter table public.households add primary key (id);
alter table public.household_members add primary key (id);
alter table public.memberships add primary key (id);
alter table public.party_bookings add primary key (id);
alter table public.people add primary key (id);
alter table public.pricing_rules add primary key (id);
alter table public.roles add primary key (id);
alter table public.webhook_log add primary key (id);

-- =========================================
-- FOREIGN KEYS
-- =========================================
alter table public.households
  add constraint households_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;

alter table public.household_members
  add constraint household_members_household_id_fkey
  foreign key (household_id) references public.households(id) on delete cascade;

alter table public.household_members
  add constraint household_members_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;

alter table public.people
  add constraint people_household_id_fkey
  foreign key (household_id) references public.households(id) on delete cascade;

alter table public.checkins
  add constraint checkins_person_id_fkey
  foreign key (person_id) references public.people(id) on delete cascade;

alter table public.class_registrations
  add constraint class_registrations_class_id_fkey
  foreign key (class_id) references public.classes(id) on delete cascade;

alter table public.class_registrations
  add constraint class_registrations_person_id_fkey
  foreign key (person_id) references public.people(id) on delete cascade;

alter table public.party_bookings
  add constraint party_bookings_household_id_fkey
  foreign key (household_id) references public.households(id) on delete cascade;

alter table public.memberships
  add constraint memberships_household_id_fkey
  foreign key (household_id) references public.households(id) on delete cascade;

alter table public.memberships
  add constraint memberships_person_id_fkey
  foreign key (person_id) references public.people(id) on delete cascade;

alter table public.roles
  add constraint roles_id_fkey
  foreign key (id) references auth.users(id) on delete cascade;

-- =========================================
-- UNIQUE CONSTRAINTS
-- =========================================
alter table public.catalog_items
  add constraint catalog_items_external_item_id_key unique (external_item_id);

alter table public.class_registrations
  add constraint class_registrations_class_id_person_id_key unique (class_id, person_id);

alter table public.roles
  add constraint roles_id_key unique (id);

alter table public.memberships
  add constraint memberships_square_subscription_id_key unique (square_subscription_id);

alter table public.household_members
  add constraint household_members_household_id_user_id_key unique (household_id, user_id);

-- household membership only 1 active row idea (optional if historical rows not needed)
-- alter table public.memberships
--   add constraint memberships_household_id_key unique (household_id);

-- =========================================
-- CHECK CONSTRAINTS
-- =========================================
alter table public.classes
  add constraint classes_capacity_check check (capacity is null or capacity >= 0),
  add constraint classes_price_cents_check check (price_cents >= 0),
  add constraint classes_time_check check (end_time > start_time),
  add constraint classes_status_check check (status in ('scheduled','cancelled','completed'));

alter table public.class_registrations
  add constraint class_registrations_status_check check (status in ('scheduled','cancelled','waitlist','attended'));

alter table public.checkins
  add constraint checkins_price_cents_check check (price_cents >= 0);

alter table public.party_bookings
  add constraint party_bookings_time_check check (end_time > start_time),
  add constraint party_bookings_headcount_check check (headcount_expected is null or headcount_expected >= 0),
  add constraint party_bookings_price_quote_check check (price_quote_cents is null or price_quote_cents >= 0);

alter table public.pricing_rules
  add constraint pricing_rules_months_check check (
    (min_months is null or min_months >= 0) and
    (max_months is null or max_months >= 0) and
    (min_months is null or max_months is null or min_months <= max_months)
  ),
  add constraint pricing_rules_price_check check (price_cents >= 0);

alter table public.households
  add constraint households_role_check check (role in ('owner','admin','member'));

alter table public.household_members
  add constraint household_members_role_check check (role in ('owner','admin','member'));

alter table public.memberships
  drop constraint if exists memberships_check;

alter table public.memberships
  add constraint memberships_exactly_one_target_check
  check (
    ((household_id is not null)::int + (person_id is not null)::int) = 1
  );

-- =========================================
-- UPDATED_AT
-- =========================================
alter table public.catalog_items add column if not exists updated_at timestamptz default now();
alter table public.checkins add column if not exists updated_at timestamptz default now();
alter table public.class_registrations add column if not exists updated_at timestamptz default now();
alter table public.classes add column if not exists updated_at timestamptz default now();
alter table public.households add column if not exists updated_at timestamptz default now();
alter table public.household_members add column if not exists updated_at timestamptz default now();
alter table public.memberships add column if not exists updated_at timestamptz default now();
alter table public.party_bookings add column if not exists updated_at timestamptz default now();
alter table public.people add column if not exists updated_at timestamptz default now();
alter table public.pricing_rules add column if not exists updated_at timestamptz default now();
alter table public.roles add column if not exists updated_at timestamptz default now();
alter table public.webhook_log add column if not exists updated_at timestamptz default now();

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
declare
  _household_id uuid;
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_updated_at_catalog_items on public.catalog_items;
create trigger set_updated_at_catalog_items
before update on public.catalog_items
for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at_checkins on public.checkins;
create trigger set_updated_at_checkins
before update on public.checkins
for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at_class_registrations on public.class_registrations;
create trigger set_updated_at_class_registrations
before update on public.class_registrations
for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at_classes on public.classes;
create trigger set_updated_at_classes
before update on public.classes
for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at_households on public.households;
create trigger set_updated_at_households
before update on public.households
for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at_household_members on public.household_members;
create trigger set_updated_at_household_members
before update on public.household_members
for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at_memberships on public.memberships;
create trigger set_updated_at_memberships
before update on public.memberships
for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at_party_bookings on public.party_bookings;
create trigger set_updated_at_party_bookings
before update on public.party_bookings
for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at_people on public.people;
create trigger set_updated_at_people
before update on public.people
for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at_pricing_rules on public.pricing_rules;
create trigger set_updated_at_pricing_rules
before update on public.pricing_rules
for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at_roles on public.roles;
create trigger set_updated_at_roles
before update on public.roles
for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at_webhook_log on public.webhook_log;
create trigger set_updated_at_webhook_log
before update on public.webhook_log
for each row execute function public.set_updated_at();

-- =========================================
-- INDEXES
-- =========================================
create index if not exists idx_people_household_id on public.people(household_id);
create index if not exists idx_checkins_person_id on public.checkins(person_id);
create index if not exists idx_checkins_checked_in_at on public.checkins(checked_in_at desc);
create index if not exists idx_class_registrations_class_id on public.class_registrations(class_id);
create index if not exists idx_class_registrations_person_id on public.class_registrations(person_id);
create index if not exists idx_classes_start_time on public.classes(start_time);
create index if not exists idx_household_members_household_id on public.household_members(household_id);
create index if not exists idx_household_members_user_id on public.household_members(user_id);
create index if not exists idx_memberships_household_id on public.memberships(household_id);
create index if not exists idx_memberships_person_id on public.memberships(person_id);
create index if not exists idx_party_bookings_household_id on public.party_bookings(household_id);
create index if not exists idx_party_bookings_start_time on public.party_bookings(start_time);
create index if not exists idx_webhook_log_received_at on public.webhook_log(received_at desc);

alter table public.people
add column if not exists role text not null default 'child';

alter table public.people
add constraint people_role_check
check (role in ('adult', 'child'));

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _household_id uuid;
begin
  insert into public.households (user_id, role, name)
  values (new.id, 'owner', 'My Household')
  returning id into _household_id;

  insert into public.household_members (household_id, user_id, role)
  values (_household_id, new.id, 'owner');

  insert into public.roles (id, role)
  values (new.id, 'owner');

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
after insert on auth.users
for each row
execute function public.handle_new_user();
create table if not exists public.occupancy_events (
    id uuid default gen_random_uuid() not null,
    event_type text not null,
    delta integer not null default 0,
    effective_date date not null default current_date,
    notes text,
    metadata jsonb default '{}'::jsonb,
    created_by uuid,
    created_at timestamp with time zone default now(),
    updated_at timestamp with time zone default now()
);

alter table public.occupancy_events add primary key (id);

alter table public.occupancy_events
  add constraint occupancy_events_created_by_fkey
  foreign key (created_by) references auth.users(id) on delete set null;

alter table public.occupancy_events
  add constraint occupancy_events_event_type_check
  check (event_type in ('checkin_increment', 'manual_increment', 'manual_decrement', 'reset'));

alter table public.classes add column if not exists duration_minutes integer;
alter table public.classes add column if not exists instructor_name text;
alter table public.classes add column if not exists description text;
alter table public.classes add column if not exists age_range text;

alter table public.classes
  add constraint classes_duration_minutes_check
  check (duration_minutes is null or duration_minutes > 0);

alter table public.party_bookings add column if not exists status text default 'pending';
alter table public.party_bookings add column if not exists status_updated_at timestamp with time zone default now();

alter table public.party_bookings
  add constraint party_bookings_status_check
  check (status in ('pending', 'confirmed', 'cancelled'));

alter table public.party_bookings
  alter column status set default 'pending';

create index if not exists idx_occupancy_events_effective_date on public.occupancy_events(effective_date);
create index if not exists idx_occupancy_events_created_at on public.occupancy_events(created_at desc);
create index if not exists idx_party_bookings_status on public.party_bookings(status);

update public.classes
set duration_minutes = greatest(round(extract(epoch from (end_time - start_time)) / 60.0)::integer, 1)
where duration_minutes is null;

update public.party_bookings
set status = coalesce(status, 'pending'),
    status_updated_at = coalesce(status_updated_at, created_at, now());

drop trigger if exists set_updated_at_occupancy_events on public.occupancy_events;
create trigger set_updated_at_occupancy_events
before update on public.occupancy_events
for each row execute function public.set_updated_at();
