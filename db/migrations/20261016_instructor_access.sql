begin;

-- Additive roles preserve existing public.roles and operator RPCs.
create table if not exists public.user_roles (
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'staff', 'instructor', 'owner', 'admin')),
  primary key (user_id, role)
);
create table if not exists public.class_instructors (
  class_id uuid not null references public.classes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key (class_id, user_id)
);
create index if not exists class_instructors_user_idx on public.class_instructors(user_id);
alter table public.classes add column if not exists instructor_note text;
alter table public.user_roles enable row level security;
alter table public.class_instructors enable row level security;
drop policy if exists user_roles_self_select on public.user_roles;
create policy user_roles_self_select on public.user_roles for select to authenticated using (user_id = auth.uid());
drop policy if exists class_instructors_self_select on public.class_instructors;
create policy class_instructors_self_select on public.class_instructors for select to authenticated using (user_id = auth.uid());
-- Writes are performed by owner-authorized server endpoints only.

commit;
