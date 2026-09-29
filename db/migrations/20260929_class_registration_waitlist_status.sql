alter table public.class_registrations
drop constraint if exists class_registrations_status_check;

alter table public.class_registrations
add constraint class_registrations_status_check
check (status in ('scheduled', 'cancelled', 'waitlist', 'attended'));
