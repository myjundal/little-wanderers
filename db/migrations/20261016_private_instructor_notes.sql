begin;

-- Public class metadata must never carry private instructor instructions.
create table if not exists public.class_instructor_notes (
  class_id uuid primary key references public.classes(id) on delete cascade,
  note text not null default '' check (char_length(note) <= 4000)
);
alter table public.class_instructor_notes enable row level security;
revoke all on public.class_instructor_notes from anon, authenticated;
grant all on public.class_instructor_notes to service_role;

-- Preserve any notes already saved before removing the public column.
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'classes' and column_name = 'instructor_note') then
    execute 'insert into public.class_instructor_notes (class_id, note)
             select id, instructor_note from public.classes
             where instructor_note is not null
             on conflict (class_id) do update set note = excluded.note';
    execute 'alter table public.classes drop column instructor_note';
  end if;
end;
$$;

commit;
