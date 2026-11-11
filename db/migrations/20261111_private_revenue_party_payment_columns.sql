-- These fields already exist in the verified production party invoice schema.
-- Keep fresh databases consistent; absence of a linked order is never proof
-- that a legacy party is unpaid. The reporting projection flags it for review.
alter table public.party_bookings
  add column if not exists square_environment text,
  add column if not exists square_order_id text,
  add column if not exists deposit_paid_cents integer,
  add column if not exists balance_paid_cents integer,
  add column if not exists payment_review_required boolean;
