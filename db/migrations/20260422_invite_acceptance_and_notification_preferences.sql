begin;

alter table public.household_invites
  add column if not exists accepted_by_user_id uuid references auth.users(id) on delete set null;

create index if not exists idx_household_invites_token on public.household_invites(invite_token);

alter table public.push_subscriptions
  add column if not exists less_crowded_enabled boolean not null default true,
  add column if not exists notify_when_level_at_or_below text not null default 'moderate',
  add column if not exists quiet_hours_enabled boolean not null default false,
  add column if not exists quiet_start_hour integer,
  add column if not exists quiet_end_hour integer,
  add column if not exists timezone_offset_minutes integer not null default 0;

alter table public.push_subscriptions
  drop constraint if exists push_subscriptions_notify_level_check;

alter table public.push_subscriptions
  add constraint push_subscriptions_notify_level_check
  check (notify_when_level_at_or_below in ('light', 'moderate', 'busy', 'near_capacity'));

alter table public.push_subscriptions
  drop constraint if exists push_subscriptions_quiet_hour_check;

alter table public.push_subscriptions
  add constraint push_subscriptions_quiet_hour_check
  check (
    (quiet_start_hour is null or (quiet_start_hour between 0 and 23))
    and (quiet_end_hour is null or (quiet_end_hour between 0 and 23))
  );

commit;
