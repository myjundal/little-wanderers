begin;

-- Auth users who sign up from the waitlist are customer users.
-- Household membership can still use role='owner' for the adult who owns a family account;
-- public.roles controls staff/admin access and must not default to owner.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _household_id uuid;
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'households'
      and column_name = 'user_id'
  ) then
    execute
      'insert into public.households (user_id, role, name, email)
       values ($1, $2, $3, $4)
       returning id'
      using new.id, 'owner', 'My Household', new.email
      into _household_id;
  else
    insert into public.households (role, name, email)
    values ('owner', 'My Household', new.email)
    returning id into _household_id;
  end if;

  insert into public.household_members (household_id, user_id, role)
  values (_household_id, new.id, 'owner')
  on conflict (household_id, user_id) do nothing;

  insert into public.roles (id, role)
  values (new.id, 'user')
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
after insert on auth.users
for each row
execute function public.handle_new_user();

-- Repair waitlist-created accounts that were incorrectly granted app owner access.
update public.roles r
set role = 'user',
    updated_at = now()
from public.waitlist_entries w
where w.claimed_user_id = r.id
  and r.role = 'owner';

commit;
