begin;

create table if not exists public.waitlist_entries (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  normalized_email text not null unique,
  first_name text,
  last_name text,
  source text not null default 'google_form',
  external_id text,
  invite_token uuid not null default gen_random_uuid(),
  raw_payload jsonb,
  claimed_user_id uuid references auth.users(id) on delete set null,
  claimed_at timestamptz,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint waitlist_entries_email_check check (position('@' in email) > 1),
  constraint waitlist_entries_normalized_email_check check (position('@' in normalized_email) > 1)
);

create unique index if not exists waitlist_entries_invite_token_idx on public.waitlist_entries(invite_token);
create index if not exists waitlist_entries_claimed_user_id_idx on public.waitlist_entries(claimed_user_id);

drop trigger if exists set_updated_at_waitlist_entries on public.waitlist_entries;
create trigger set_updated_at_waitlist_entries
before update on public.waitlist_entries
for each row execute function public.set_updated_at();

alter table public.waitlist_entries enable row level security;

commit;
