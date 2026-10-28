begin;
alter table public.waivers
  add column if not exists waiver_version text,
  add column if not exists signed_by_user_id uuid references auth.users(id) on delete set null,
  add column if not exists covered_person_ids uuid[],
  add column if not exists agreement_snapshot jsonb;

-- Signed evidence is append-only through the authenticated server endpoint.
-- Browser clients can read their own household through existing RLS policies.
revoke insert, update, delete on public.waivers from anon, authenticated;
grant select on public.waivers to authenticated;
grant all on public.waivers to service_role;
alter table public.waivers enable row level security;
notify pgrst, 'reload schema';
commit;
