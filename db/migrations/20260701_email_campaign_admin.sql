begin;

create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  normalized_email text not null unique,
  first_name text,
  last_name text,
  source text not null default 'manual',
  unsubscribe_token uuid not null default gen_random_uuid(),
  unsubscribed_at timestamptz,
  bounced_at timestamptz,
  complained_at timestamptz,
  raw_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint contacts_email_check check (position('@' in email) > 1),
  constraint contacts_normalized_email_check check (position('@' in normalized_email) > 1)
);

create unique index if not exists contacts_unsubscribe_token_key on public.contacts(unsubscribe_token);
create index if not exists contacts_email_status_idx on public.contacts(unsubscribed_at, bounced_at, complained_at);

create table if not exists public.contact_tags (
  contact_id uuid not null references public.contacts(id) on delete cascade,
  tag text not null,
  created_at timestamptz not null default now(),
  primary key (contact_id, tag),
  constraint contact_tags_tag_check check (tag ~ '^[a-z0-9_:-]+$')
);

create index if not exists contact_tags_tag_idx on public.contact_tags(tag);

create table if not exists public.email_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Untitled campaign',
  subject text not null default '',
  preview_text text not null default '',
  body_html text not null default '',
  status text not null default 'draft',
  test_sent_at timestamptz,
  sent_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint email_campaigns_status_check check (status in ('draft', 'sending', 'sent'))
);

create index if not exists email_campaigns_created_at_idx on public.email_campaigns(created_at desc);

create table if not exists public.email_sends (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.email_campaigns(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  send_type text not null default 'campaign',
  email text not null,
  status text not null default 'queued',
  provider_message_id text,
  error_message text,
  attempted_at timestamptz not null default now(),
  sent_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint email_sends_send_type_check check (send_type in ('campaign', 'test')),
  constraint email_sends_status_check check (status in ('queued', 'sent', 'failed', 'skipped'))
);

create unique index if not exists email_sends_campaign_contact_once_idx
  on public.email_sends(campaign_id, contact_id)
  where send_type = 'campaign' and contact_id is not null;

create index if not exists email_sends_campaign_idx on public.email_sends(campaign_id, created_at desc);
create index if not exists email_sends_contact_idx on public.email_sends(contact_id);

drop trigger if exists set_updated_at_contacts on public.contacts;
create trigger set_updated_at_contacts
before update on public.contacts
for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at_email_campaigns on public.email_campaigns;
create trigger set_updated_at_email_campaigns
before update on public.email_campaigns
for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at_email_sends on public.email_sends;
create trigger set_updated_at_email_sends
before update on public.email_sends
for each row execute function public.set_updated_at();

alter table public.contacts enable row level security;
alter table public.contact_tags enable row level security;
alter table public.email_campaigns enable row level security;
alter table public.email_sends enable row level security;

insert into public.contacts (email, normalized_email, first_name, last_name, source, raw_metadata, created_at, updated_at)
select
  w.email,
  w.normalized_email,
  w.first_name,
  w.last_name,
  'waitlist',
  jsonb_build_object('waitlist_entry_id', w.id, 'waitlist_source', w.source),
  w.created_at,
  now()
from public.waitlist_entries w
on conflict (normalized_email) do update
set
  email = excluded.email,
  first_name = coalesce(public.contacts.first_name, excluded.first_name),
  last_name = coalesce(public.contacts.last_name, excluded.last_name),
  raw_metadata = public.contacts.raw_metadata || excluded.raw_metadata,
  updated_at = now();

insert into public.contact_tags (contact_id, tag)
select c.id, 'waitlist'
from public.contacts c
inner join public.waitlist_entries w on w.normalized_email = c.normalized_email
on conflict do nothing;

commit;
