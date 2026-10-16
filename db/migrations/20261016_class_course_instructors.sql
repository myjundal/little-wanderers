begin;
-- One private account assignment per class name; session access remains in class_instructors.
create table if not exists public.class_course_instructors (
 class_title text primary key check(char_length(btrim(class_title))>0),
 user_id uuid not null references auth.users(id) on delete cascade
);
alter table public.class_course_instructors enable row level security;
revoke all on public.class_course_instructors from public,anon,authenticated;
grant all on public.class_course_instructors to service_role;

-- Serialize assignment changes and session creation for the same class name.
create or replace function public.lock_class_instructor_course()
returns trigger language plpgsql security definer set search_path=public as $$
declare course text; names text[];
begin
 if TG_TABLE_NAME='classes' then
  names:=array[NEW.title];
  if TG_OP='UPDATE' then names:=array[OLD.title,NEW.title]; end if;
 else
  if TG_OP='DELETE' then names:=array[OLD.class_title]; else names:=array[NEW.class_title]; end if;
 end if;
 for course in select distinct name from unnest(names) as item(name) order by name loop
  perform pg_advisory_xact_lock(hashtextextended(course,0));
 end loop;
 if TG_OP='DELETE' then return OLD; else return NEW; end if;
end; $$;

create or replace function public.sync_course_instructor_sessions()
returns trigger language plpgsql security definer set search_path=public as $$
declare course text;
begin
 if TG_OP='DELETE' then course:=OLD.class_title; else course:=NEW.class_title; end if;
 delete from public.class_instructors a using public.classes c where a.class_id=c.id and c.title=course;
 if TG_OP<>'DELETE' then
  insert into public.class_instructors(class_id,user_id) select id,NEW.user_id from public.classes where title=course;
 end if;
 if TG_OP='DELETE' then return OLD; else return NEW; end if;
end; $$;

create or replace function public.inherit_course_instructor()
returns trigger language plpgsql security definer set search_path=public as $$
declare teacher uuid;
begin
 if TG_OP='UPDATE' and OLD.title is distinct from NEW.title then
  delete from public.class_instructors where class_id=NEW.id;
 end if;
 select user_id into teacher from public.class_course_instructors where class_title=NEW.title;
 if teacher is not null then
  delete from public.class_instructors where class_id=NEW.id and user_id<>teacher;
  insert into public.class_instructors(class_id,user_id) values(NEW.id,teacher) on conflict do nothing;
 end if;
 return NEW;
end; $$;

drop trigger if exists class_course_instructor_lock on public.class_course_instructors;
create trigger class_course_instructor_lock before insert or update or delete on public.class_course_instructors
for each row execute function public.lock_class_instructor_course();
drop trigger if exists class_course_instructor_sync on public.class_course_instructors;
create trigger class_course_instructor_sync after insert or update or delete on public.class_course_instructors
for each row execute function public.sync_course_instructor_sessions();
drop trigger if exists class_session_instructor_lock on public.classes;
create trigger class_session_instructor_lock before insert or update of title on public.classes
for each row execute function public.lock_class_instructor_course();
drop trigger if exists class_session_instructor_inherit on public.classes;
create trigger class_session_instructor_inherit after insert or update of title on public.classes
for each row execute function public.inherit_course_instructor();

-- The API authorizes the owner; role and complete assignment replacement are atomic.
create or replace function public.set_class_course_instructor(p_class_title text,p_user_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(p_class_title,0));
 if not exists(select 1 from public.classes where title=p_class_title) then
  return jsonb_build_object('ok',false,'error','Class not found.');
 end if;
 if p_user_id is null then
  delete from public.class_course_instructors where class_title=p_class_title;
  delete from public.class_instructors a using public.classes c where a.class_id=c.id and c.title=p_class_title;
 else
  insert into public.user_roles(user_id,role) values(p_user_id,'instructor') on conflict do nothing;
  insert into public.class_course_instructors(class_title,user_id) values(p_class_title,p_user_id)
  on conflict(class_title) do update set user_id=excluded.user_id;
 end if;
 return jsonb_build_object('ok',true);
end; $$;
revoke all on function public.lock_class_instructor_course(),public.sync_course_instructor_sessions(),public.inherit_course_instructor(),public.set_class_course_instructor(text,uuid) from public,anon,authenticated;
grant execute on function public.set_class_course_instructor(text,uuid) to service_role;
commit;
