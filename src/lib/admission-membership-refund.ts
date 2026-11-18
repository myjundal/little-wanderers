import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { squareConfig, squareRequest, assertUsd, squareCustomerMatches } from '@/lib/square-client';

type Money = { amount: number; currency: string };
type Refund = { id: string; payment_id: string; status: string; amount_money: Money; reason?: string };
type Input = { householdId: string; orderId: string; expectedAmountCents: number };
const ownerId = '5054a175-2ba6-4023-a289-a9b0635ccc5f';

/** Full original-card admission refund after the owner activates a family membership.
 * Never changes the membership charge or rewrites the original admission receipt. */
export async function previewAdmissionMembershipRefund(admin: SupabaseClient, input: Input) {
  const cfg = squareConfig();
  if (cfg.environment !== 'production' || !Number.isSafeInteger(input.expectedAmountCents) || input.expectedAmountCents <= 0) throw Error('Verify a production admission amount.');
  const visits = await admin.from('checkins').select('id,household_id,price_cents,payment_status,square_environment,square_order_id').eq('square_order_id', input.orderId);
  if (visits.error || !visits.data?.length || visits.data.some(v => v.household_id !== input.householdId || v.square_environment !== 'production' || v.payment_status !== 'paid' || !Number.isSafeInteger(v.price_cents) || v.price_cents <= 0)
    || visits.data.reduce((sum, v) => sum + v.price_cents, 0) !== input.expectedAmountCents) throw Error('Verify exclusive paid admission allocations.');
  const memberships = await admin.from('founding_memberships').select('id,status,environment,square_customer_id,square_subscription_id').eq('household_id', input.householdId).eq('environment', 'production').eq('status', 'active');
  if (memberships.error || memberships.data?.length !== 1 || !memberships.data[0].square_subscription_id) throw Error('Verify the activated family membership.');
  const { order } = await squareRequest<{ order: { id: string; location_id: string; customer_id?: string; total_money: Money; total_tax_money?: Money; total_tip_money?: Money; tenders?: { payment_id?: string }[] } }>(`/v2/orders/${encodeURIComponent(input.orderId)}`);
  if (order.id !== input.orderId || order.location_id !== cfg.locationId || order.tenders?.length !== 1 || !order.tenders[0].payment_id || (order.total_tax_money?.amount ?? 0) !== 0 || (order.total_tip_money?.amount ?? 0) !== 0) throw Error('Verify one untaxed, untipped admission payment.');
  assertUsd(order.total_money, input.expectedAmountCents);
  const paymentId = order.tenders[0].payment_id;
  const { payment } = await squareRequest<{ payment: { id: string; order_id: string; customer_id?: string; location_id: string; status: string; source_type: string; amount_money: Money; total_money?: Money; tip_money?: Money; refunded_money?: Money; refund_ids?: string[] } }>(`/v2/payments/${encodeURIComponent(paymentId)}`);
  if (payment.id !== paymentId || payment.order_id !== order.id || payment.location_id !== cfg.locationId || payment.status !== 'COMPLETED' || payment.source_type !== 'CARD' || (payment.tip_money?.amount ?? 0) !== 0) throw Error('Verify the original completed card payment.');
  assertUsd(payment.amount_money, input.expectedAmountCents);
  if (payment.total_money) assertUsd(payment.total_money, input.expectedAmountCents);
  for (const customer of [order.customer_id, payment.customer_id]) if (customer && !await squareCustomerMatches(customer, memberships.data[0].square_customer_id)) throw Error('Provider payment belongs to a different customer.');
  const reason = `Admission refund after membership activation: ${input.householdId}`;
  const digest = createHash('sha256').update(`admission-membership-refund-v1:production:${input.householdId}:${paymentId}`).digest('hex');
  const key = 'lw-adm-ref-' + digest.slice(0, 32);
  const eventId = `${digest.slice(0,8)}-${digest.slice(8,12)}-5${digest.slice(13,16)}-8${digest.slice(17,20)}-${digest.slice(20,32)}`;
  let existing: Refund | null = null;
  if ((payment.refund_ids?.length ?? 0) > 30) throw Error('Review refund history.');
  for (const id of payment.refund_ids ?? []) {
    const { refund } = await squareRequest<{ refund: Refund }>(`/v2/refunds/${encodeURIComponent(id)}`);
    if (!refund || refund.id !== id || refund.payment_id !== payment.id || refund.reason !== reason || !['PENDING', 'COMPLETED'].includes(refund.status) || existing) throw Error('Review the existing refund before another attempt.');
    assertUsd(refund.amount_money, input.expectedAmountCents);
    existing = refund;
  }
  const refunded = payment.refunded_money?.amount ?? 0;
  if (!Number.isSafeInteger(refunded) || refunded < 0 || (refunded > 0 && (!existing || refunded !== input.expectedAmountCents))) throw Error('This payment has another refund.');
  const snapshot = { version: 1, environment: 'production', household_id: input.householdId, order_id: order.id, payment_id: payment.id, amount_cents: input.expectedAmountCents, enrollment_id: memberships.data[0].id, checkin_ids: visits.data.map(v => v.id).sort(), idempotency_key: key };
  return { payment, existing, reason, key, eventId, snapshot, amount_cents: input.expectedAmountCents };
}

export async function refundAdmissionMembership(admin: SupabaseClient, input: Input) {
  const prepared = await previewAdmissionMembershipRefund(admin, input);
  const readAudit = async () => {
    const result = await admin.from('membership_events').select('notes').eq('id', prepared.eventId).maybeSingle();
    if (result.error) throw Error('Unable to verify refund audit.');
    if (!result.data) return null;
    const value = JSON.parse(result.data.notes);
    if (JSON.stringify(value.request) !== JSON.stringify(prepared.snapshot)) throw Error('Refund audit parameters changed.');
    return value;
  };
  if (!await readAudit()) {
    const saved = await admin.from('membership_events').insert({ id: prepared.eventId, household_id: input.householdId, action: 'admission_membership_refund', notes: JSON.stringify({ request: prepared.snapshot, state: 'requested' }), created_by_user_id: ownerId, created_by_role: 'owner' });
    if (saved.error && saved.error.code !== '23505') throw Error('Unable to save refund authorization. No new refund was requested.');
    if (!await readAudit()) throw Error('Unable to confirm refund authorization.');
  }
  const refund = prepared.existing ?? (await squareRequest<{ refund: Refund }>('/v2/refunds', 'POST', { idempotency_key: prepared.key, payment_id: prepared.payment.id, amount_money: { amount: prepared.amount_cents, currency: 'USD' }, reason: prepared.reason })).refund;
  if (!refund?.id || refund.payment_id !== prepared.payment.id || !['PENDING', 'COMPLETED'].includes(refund.status)) throw Error('Verify refund status before retrying.');
  assertUsd(refund.amount_money, prepared.amount_cents);
  const saved = await admin.from('membership_events').update({ notes: JSON.stringify({ request: prepared.snapshot, state: 'accepted', refund_id: refund.id, status: refund.status, checked_at: new Date().toISOString() }) }).eq('id', prepared.eventId).select('id');
  return { refund_id: refund.id, payment_id: prepared.payment.id, status: refund.status, amount_cents: prepared.amount_cents, audit_saved: !saved.error && saved.data?.length === 1 };
}
