alter table public.classes
add column if not exists schedule_note text;

alter table public.class_registrations
add column if not exists waitlist_offer_token uuid,
add column if not exists waitlist_offer_expires_at timestamptz,
add column if not exists waitlist_offered_at timestamptz;

alter table public.class_registrations
drop constraint if exists class_registrations_status_check;

alter table public.class_registrations
add constraint class_registrations_status_check
check (status in ('scheduled', 'cancelled', 'waitlist', 'attended'));

create unique index if not exists class_registrations_waitlist_offer_token_key
on public.class_registrations(waitlist_offer_token)
where waitlist_offer_token is not null;
