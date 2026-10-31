-- The deployed check-in and Square POS functions write covered/due/paid.
-- Retain legacy values so existing admission records remain valid.
begin;
alter table public.checkins drop constraint if exists checkins_payment_status_check;
alter table public.checkins add constraint checkins_payment_status_check
  check (payment_status is null or payment_status in (
    'membership', 'prepaid', 'walkin_paid', 'terminal_paid', 'included',
    'covered', 'due', 'paid'
  ));
commit;
