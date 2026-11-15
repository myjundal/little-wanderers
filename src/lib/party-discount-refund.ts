import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { squareConfig, squareRequest, assertUsd } from '@/lib/square-client';

type Money = { amount: number; currency: string };
type Payment = { id: string; order_id: string; location_id: string; status: string; source_type: string; amount_money: Money; tip_money?: Money; refunded_money?: Money; refund_ids?: string[] };
type Refund = { id: string; payment_id: string; status: string; amount_money: Money; reason?: string };
type Input = { partyId: string; orderId: string; paymentId: string; expectedPaymentCents: number };
export const PARTY_FRIENDS_FAMILY_REFUND_CENTS = 5000;

/** A flat $50 adjustment to one fully paid, exclusively linked card receipt.
 * The provider idempotency key is stable even if the audit save or response fails. */
export async function previewPartyDiscountRefund(admin: SupabaseClient, input: Input) {
  const cfg = squareConfig();
  if (cfg.environment !== 'production') throw new Error('Production Square access is required.');
  const result = await admin.from('party_bookings').select('id,status,square_environment,square_order_id,price_quote_cents,notes,updated_at').eq('id', input.partyId).single();
  const party = result.data;
  if (result.error || !party || !['confirmed', 'completed'].includes(party.status) || party.square_environment !== 'production'
    || party.square_order_id !== input.orderId || party.price_quote_cents !== input.expectedPaymentCents
    || !Number.isSafeInteger(input.expectedPaymentCents) || input.expectedPaymentCents <= PARTY_FRIENDS_FAMILY_REFUND_CENTS) throw new Error('Verify the linked party and original payment amount first.');
  const linked = await admin.from('party_bookings').select('id').eq('square_environment', 'production').eq('square_order_id', input.orderId).limit(2);
  if (linked.error || linked.data?.length !== 1 || linked.data[0].id !== party.id) throw new Error('This receipt must belong exclusively to one party.');
  const { order } = await squareRequest<{ order: { id: string; location_id: string; total_money: Money; total_tax_money?: Money; total_tip_money?: Money; tenders?: { payment_id?: string }[] } }>(`/v2/orders/${encodeURIComponent(input.orderId)}`);
  if (order.id !== input.orderId || order.location_id !== cfg.locationId || order.tenders?.length !== 1 || order.tenders[0].payment_id !== input.paymentId
    || (order.total_tax_money?.amount ?? 0) !== 0 || (order.total_tip_money?.amount ?? 0) !== 0) throw new Error('Choose one untaxed party card payment without tips.');
  assertUsd(order.total_money, input.expectedPaymentCents);
  const { payment } = await squareRequest<{ payment: Payment }>(`/v2/payments/${encodeURIComponent(input.paymentId)}`);
  if (payment.id !== input.paymentId || payment.order_id !== input.orderId || payment.location_id !== cfg.locationId || payment.status !== 'COMPLETED'
    || payment.source_type !== 'CARD' || (payment.tip_money?.amount ?? 0) !== 0) throw new Error('A completed matching card payment is required.');
  assertUsd(payment.amount_money, input.expectedPaymentCents);
  const reason = `Friends & Family discount: party ${party.id}`;
  const key = 'lw-party-ff-' + createHash('sha256').update(`${cfg.environment}:${party.id}:${payment.id}`).digest('hex').slice(0, 32);
  let existing: Refund | null = null;
  if ((payment.refund_ids?.length ?? 0) > 30) throw new Error('Refund history needs review.');
  for (const id of payment.refund_ids ?? []) {
    const { refund } = await squareRequest<{ refund: Refund }>(`/v2/refunds/${encodeURIComponent(id)}`);
    if (!refund || refund.id !== id || refund.payment_id !== payment.id || refund.reason !== reason || !['PENDING', 'COMPLETED'].includes(refund.status) || existing) throw new Error('Existing refund requires review before any further adjustment.');
    assertUsd(refund.amount_money, PARTY_FRIENDS_FAMILY_REFUND_CENTS);
    existing = refund;
  }
  const refunded = payment.refunded_money?.amount ?? 0;
  if (!Number.isSafeInteger(refunded) || refunded < 0 || (refunded > 0 && (!existing || refunded !== PARTY_FRIENDS_FAMILY_REFUND_CENTS))) throw new Error('This payment already has a different refund.');
  return { party, payment, existing, reason, key, amount_cents: PARTY_FRIENDS_FAMILY_REFUND_CENTS };
}

export async function refundPartyDiscount(admin: SupabaseClient, input: Input) {
  const prepared = await previewPartyDiscountRefund(admin, input);
  const refund = prepared.existing ?? (await squareRequest<{ refund: Refund }>('/v2/refunds', 'POST', {
    idempotency_key: prepared.key, payment_id: prepared.payment.id,
    amount_money: { amount: prepared.amount_cents, currency: 'USD' }, reason: prepared.reason,
  })).refund;
  if (!refund?.id || refund.payment_id !== input.paymentId || !['PENDING', 'COMPLETED'].includes(refund.status)) throw new Error('Square has not accepted the refund. Verify its status before retrying.');
  assertUsd(refund.amount_money, prepared.amount_cents);
  const note = `[Friends & Family refund ${refund.id}] USD 50 refund to original card; Square status ${refund.status} as of ${new Date().toISOString()}; payment ${input.paymentId}; original USD ${(input.expectedPaymentCents / 100).toFixed(2)}, after adjustment USD ${((input.expectedPaymentCents - prepared.amount_cents) / 100).toFixed(2)}. Authorized by personal owner.`;
  // A provider refund stays successful even if a simultaneous edit prevents the audit note save.
  let auditSaved = Boolean(prepared.party.notes?.includes(`[Friends & Family refund ${refund.id}]`));
  if (!auditSaved) {
    const saved = await admin.from('party_bookings').update({ notes: [prepared.party.notes, note].filter(Boolean).join('\n') })
      .eq('id', input.partyId).eq('updated_at', prepared.party.updated_at).eq('square_order_id', input.orderId).select('id');
    auditSaved = !saved.error && saved.data?.length === 1;
  }
  return { refund_id: refund.id, payment_id: input.paymentId, status: refund.status, amount_cents: prepared.amount_cents, audit_saved: auditSaved };
}
