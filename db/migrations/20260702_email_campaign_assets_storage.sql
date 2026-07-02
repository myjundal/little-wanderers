begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'email-campaign-assets',
  'email-campaign-assets',
  true,
  5242880,
  array['image/png', 'image/jpeg', 'image/gif', 'image/webp']
)
on conflict (id) do update
set
  public = true,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

commit;
