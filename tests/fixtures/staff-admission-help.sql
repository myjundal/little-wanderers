create role anon;create role authenticated;create role service_role;
create schema auth;create table auth.users(id uuid primary key);
create table roles(id uuid,role text);create table user_roles(user_id uuid,role text);
create table households(id uuid primary key,name text,email text,phone text,created_at timestamptz default now());
create table people(id uuid primary key,household_id uuid references households(id),role text,first_name text,last_name text,birthdate date);
create table household_members(household_id uuid,user_id uuid);
create table checkins(id uuid primary key,person_id uuid,household_id uuid,price_cents integer,payment_status text,checked_in_at timestamptz default now(),square_order_id text,square_environment text,payment_recorded_at timestamptz,notes text);
create table waivers(id uuid primary key,household_id uuid,source text,signed_by_user_id uuid,waiver_version text,signed_at timestamptz,waiver_expires_at timestamptz,electronic_signature text,covered_person_ids uuid[],agreement_snapshot jsonb);
create table memberships(household_id uuid);create table founding_memberships(household_id uuid);create table guest_waiver_identities(household_id uuid);
create table class_registrations(person_id uuid);
create table open_play_reservations(id uuid,household_id uuid,square_order_id text,payment_environment text);
create table party_bookings(id uuid,household_id uuid,square_order_id text,square_environment text);
create table class_series_sales(id uuid,household_id uuid,square_order_id text,environment text);
create table admission_pos_sales(id uuid,checkin_ids uuid[],status text,order_id text,environment text);
create table square_checkout_attempts(id uuid,order_id text,environment text);
create table square_payment_receipts(environment text,payment_id text,order_id text,amount_cents integer,refunded_cents integer,status text,provider_updated_at timestamptz,unique(environment,payment_id));
create table party_guest_waivers(waiver_id uuid,household_id uuid);
create table staff_family_search_aliases(alias_household_id uuid primary key,canonical_household_id uuid,reason text);
create function save_square_payment_receipt(p_environment text,p_payment text,p_order text,p_amount integer,p_refunded integer,p_status text,p_updated timestamptz)
returns void language sql as $$ insert into square_payment_receipts values(p_environment,p_payment,p_order,p_amount,p_refunded,p_status,p_updated)
on conflict(environment,payment_id) do update set status=excluded.status,refunded_cents=excluded.refunded_cents,provider_updated_at=excluded.provider_updated_at $$;
