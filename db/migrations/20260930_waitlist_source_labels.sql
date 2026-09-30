update public.waitlist_entries
set source = 'Wanderlist'
where source = 'google_form';

alter table public.waitlist_entries
alter column source set default 'Wanderlist';
