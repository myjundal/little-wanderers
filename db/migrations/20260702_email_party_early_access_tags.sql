begin;

insert into public.contacts (email, normalized_email, source, raw_metadata, created_at, updated_at)
select
  h.email,
  lower(regexp_replace(trim(h.email), '\s+', '', 'g')),
  'customer',
  jsonb_build_object('household_id', h.id),
  coalesce(min(pb.created_at), now()),
  now()
from public.party_bookings pb
inner join public.households h on h.id = pb.household_id
where pb.status = 'early_access_hold'
  and h.email is not null
  and position('@' in h.email) > 1
group by h.id, h.email
on conflict (normalized_email) do update
set
  raw_metadata = public.contacts.raw_metadata || excluded.raw_metadata,
  updated_at = now();

insert into public.contact_tags (contact_id, tag)
select c.id, tag_value.tag
from public.party_bookings pb
inner join public.households h on h.id = pb.household_id
inner join public.contacts c on c.normalized_email = lower(regexp_replace(trim(h.email), '\s+', '', 'g'))
cross join (values ('customer'), ('party_early_access')) as tag_value(tag)
where pb.status = 'early_access_hold'
  and h.email is not null
  and position('@' in h.email) > 1
on conflict do nothing;

commit;
