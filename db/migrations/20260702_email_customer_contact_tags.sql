begin;

insert into public.contacts (email, normalized_email, source, raw_metadata, created_at, updated_at)
select
  h.email,
  lower(regexp_replace(trim(h.email), '\s+', '', 'g')),
  'customer',
  jsonb_build_object('household_id', h.id),
  coalesce(h.created_at, now()),
  now()
from public.households h
where h.email is not null
  and position('@' in h.email) > 1
on conflict (normalized_email) do update
set
  email = excluded.email,
  source = case
    when public.contacts.source = 'waitlist' then public.contacts.source
    else excluded.source
  end,
  raw_metadata = public.contacts.raw_metadata || excluded.raw_metadata,
  updated_at = now();

insert into public.contact_tags (contact_id, tag)
select c.id, 'customer'
from public.contacts c
inner join public.households h
  on lower(regexp_replace(trim(h.email), '\s+', '', 'g')) = c.normalized_email
where h.email is not null
  and position('@' in h.email) > 1
on conflict do nothing;

commit;
