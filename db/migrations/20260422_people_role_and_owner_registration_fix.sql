begin;

alter table public.people
  add column if not exists role text not null default 'child';

alter table public.people
  drop constraint if exists people_role_check;

alter table public.people
  add constraint people_role_check
  check (role in ('adult', 'child'));

commit;
