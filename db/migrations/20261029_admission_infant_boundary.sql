begin;

-- Preserve the published 0–6 month infant rate, including the exact six-month day.
-- Membership renewal ages are a separate policy and are not changed.
create or replace function public.open_play_total_cents(p_birthdates date[], p_adults integer, p_visit_date date)
returns integer language sql immutable set search_path = public as $$
  select case when cardinality(p_birthdates) > 0 then
    (case when exists (select 1 from unnest(p_birthdates) b where b + interval '6 months' < p_visit_date) then 1600 else 1000 end)
      + greatest(cardinality(p_birthdates) - 1, 0) * 1000
    else 0 end + greatest(p_adults - 2, 0) * 500;
$$;

-- Change only admission's age comparison in the current checkout function.
-- Preserve its newer class recovery, hold expiry, permissions and membership logic.
do $$
declare
  definition text := pg_get_functiondef('public.prepare_square_checkout(uuid,text,text,text,uuid,text,jsonb)'::regprocedure);
  previous text := 'child_number>1 or person_row.birthdate+interval ''6 months''>visit';
  corrected text := 'child_number>1 or person_row.birthdate+interval ''6 months''>=visit';
begin
  if strpos(definition, previous)>0 then
    execute replace(definition, previous, corrected);
  elsif strpos(definition, corrected)=0 then
    raise exception 'Admission pricing function differs; review the infant boundary before applying';
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
