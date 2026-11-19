begin;

-- Remove only the legacy household-wide limit, retaining the installed slot
-- locking/capacity checks and the unique active (household, slot) index.
do $$
declare definition text; updated text;
begin
  definition := pg_get_functiondef('public.guard_open_play_reservation_capacity()'::regprocedure);
  if position('-- Multiple Open Play visits are allowed.' in definition) > 0 then return; end if;
  updated := regexp_replace(definition,
    $pattern$  if target\.is_soft_opening and exists \(.*?raise exception 'You already have a soft opening reservation\.' using errcode = '23505';\s*end if;$pattern$,
    '-- Multiple Open Play visits are allowed. Duplicate arrival windows are protected by the unique index.', 's');
  if updated = definition or position('children_used + new.child_count > target.capacity_children' in updated) = 0
    or position('for update' in updated) = 0 then
    raise exception 'Capacity guard needs review before enabling multiple visits';
  end if;
  execute updated;
end;
$$;

notify pgrst, 'reload schema';
commit;
