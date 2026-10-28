-- Safe assertions: no customer records or signatures are written.
do $$ begin
  if public.open_play_total_cents(array['2026-04-28']::date[],2,'2026-10-28') <> 1000 then raise exception '6-month boundary failed'; end if;
  if public.open_play_total_cents(array['2026-04-27']::date[],2,'2026-10-28') <> 1600 then raise exception 'over 6-month boundary failed'; end if;
  if public.open_play_total_cents(array['2024-01-01','2026-09-01']::date[],2,'2026-10-28') <> 2600 then raise exception 'sibling price failed'; end if;
  if public.open_play_total_cents(array['2024-01-01','2026-09-01']::date[],3,'2026-10-28') <> 3100 then raise exception 'extra adult failed'; end if;
  if has_function_privilege('anon','public.checkin_person(uuid,uuid,text,text,text)','execute') then raise exception 'anonymous check-in access'; end if;
  if has_table_privilege('authenticated','public.waivers','insert') then raise exception 'direct signature writes allowed'; end if;
end $$;
select 'PASS: infant, 6-month boundary, sibling, extra adult, server-only check-in, protected signature records' as launch_checks;
