begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.party_bookings'::regclass
      and conname = 'party_bookings_no_active_overlap'
  ) then
    alter table public.party_bookings
      add constraint party_bookings_no_active_overlap
      exclude using gist (tstzrange(start_time, end_time, '[)') with &&)
      where (coalesce(status, 'pending') <> 'cancelled');
  end if;
end
$$;

commit;
