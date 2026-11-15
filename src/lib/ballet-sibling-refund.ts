import { createHash } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { squareConfig, squareRequest, assertUsd, type SquareOrder } from '@/lib/square-client';
import { isBalletClass } from '@/lib/class-date-pricing';
import type { ClassCheckout } from '@/lib/class-checkout';

type Payment = { id: string; order_id: string; location_id: string; status: string; amount_money: { amount: number; currency: string }; refunded_money?: { amount: number }; refund_ids?: string[]; updated_at: string };
type Refund = { id: string; status: string; payment_id: string; reason?: string; amount_money: { amount: number; currency: string } };
type Input = { householdId: string; classId: string; personId: string };
const checked = <T>(result: { data: T; error: { message: string } | null }): NonNullable<T> => {
  if (result.error || result.data == null) throw new Error('Unable to verify ballet payment records.');
  return result.data as NonNullable<T>;
};

async function verifiedPayment(attempt: ClassCheckout) {
  const cfg = squareConfig();
  if (!attempt.order_id) throw new Error('Paid checkout is missing its order.');
  const { order } = await squareRequest<{ order: SquareOrder }>(`/v2/orders/${encodeURIComponent(attempt.order_id)}`);
  if (order.id !== attempt.order_id || order.location_id !== cfg.locationId || order.reference_id !== attempt.id || order.tenders?.length !== 1 || !order.tenders[0].payment_id) throw new Error('Payment order needs manual review.');
  assertUsd(order.total_money, attempt.expected_amount_cents);
  const { payment } = await squareRequest<{ payment: Payment }>(`/v2/payments/${encodeURIComponent(order.tenders[0].payment_id)}`);
  if (payment.id !== order.tenders[0].payment_id || payment.order_id !== order.id || payment.location_id !== cfg.locationId || payment.status !== 'COMPLETED') throw new Error('A completed Square payment is required.');
  assertUsd(payment.amount_money, attempt.expected_amount_cents);
  return payment;
}

export async function previewBalletSiblingRefund(admin: SupabaseClient, input: Input) {
  const cfg = squareConfig();
  const klass = checked(await admin.from('classes').select('id,title').eq('id', input.classId).single());
  if (!klass || !isBalletClass(klass.title)) throw new Error('Choose a ballet class.');
  const children = checked(await admin.from('people').select('id').eq('household_id', input.householdId).eq('role', 'child'));
  if (!children.some(child => child.id === input.personId)) throw new Error('Choose a child in this family.');
  const registrations = checked(await admin.from('class_registrations').select('person_id').eq('household_id', input.householdId)
    .eq('class_id', input.classId).in('status', ['scheduled', 'attended']));
  const confirmed = new Set(registrations.map(row => row.person_id));
  if (!confirmed.has(input.personId)) throw new Error('The selected child needs a confirmed ballet registration.');
  const rows = checked(await admin.from('square_checkout_attempts').select('*').eq('household_id', input.householdId).eq('kind', 'class')
    .eq('environment', cfg.environment).eq('status', 'completed').order('created_at')) as ClassCheckout[];
  const matching = rows.filter(row => row.payload.assignments.some(a => a.class_id === input.classId && confirmed.has(a.person_id) && children.some(child => child.id === a.person_id)));
  const target = matching.find(row => row.payload.assignments.some(a => a.class_id === input.classId && a.person_id === input.personId));
  if (!target || target.payload.assignments.length !== 1 || target.payload.line_items.length !== 1) throw new Error('This adjustment requires one verified class payment for the selected child.');
  const sibling = matching.find(row => row.created_at < target.created_at && row.payload.assignments.some(a => a.class_id === input.classId && a.person_id !== input.personId));
  if (!sibling) throw new Error('A previously paid sibling in the same class date is required.');
  if (target.payload.pricing?.discount_cents) throw new Error('The sibling discount was already applied at checkout.');
  const firstPayment = await verifiedPayment(sibling);
  if ((firstPayment.refunded_money?.amount ?? 0) >= firstPayment.amount_money.amount) throw new Error('The first sibling payment was refunded. Review this family before adjusting payment.');
  const payment = await verifiedPayment(target);
  const amountCents = Math.round(target.expected_amount_cents * 0.2);
  const reason = `Ballet sibling discount 20%: ${input.classId}:${input.personId}`;
  const key = 'lw-ballet20-' + createHash('sha256').update(`${cfg.environment}:${input.householdId}:${input.classId}:${input.personId}`).digest('hex').slice(0, 32);
  let existing: Refund | null = null;
  for (const id of payment.refund_ids ?? []) {
    const { refund } = await squareRequest<{ refund: Refund }>(`/v2/refunds/${encodeURIComponent(id)}`);
    if (refund.payment_id === payment.id && refund.reason === reason && ['PENDING', 'COMPLETED'].includes(refund.status)) existing = refund;
  }
  if (existing) assertUsd(existing.amount_money, amountCents);
  else if ((payment.refunded_money?.amount ?? 0) > 0) throw new Error('This payment already has a refund. Review it before another adjustment.');
  return { target, payment, amountCents, reason, key, existing };
}

export async function refundBalletSibling(admin: SupabaseClient, input: Input & { expectedAmountCents: number; ownerId: string }) {
  const prepared = await previewBalletSiblingRefund(admin, input);
  if (prepared.amountCents !== input.expectedAmountCents) throw new Error('The refund amount changed. Review it before sending.');
  const refund = prepared.existing ?? (await squareRequest<{ refund: Refund }>('/v2/refunds', 'POST', {
    idempotency_key: prepared.key, payment_id: prepared.payment.id,
    amount_money: { amount: prepared.amountCents, currency: 'USD' }, reason: prepared.reason,
  })).refund;
  if (!refund?.id || refund.payment_id !== prepared.payment.id || !['PENDING', 'COMPLETED'].includes(refund.status)) throw new Error('Square did not accept the refund. Check its status before retrying.');
  assertUsd(refund.amount_money, prepared.amountCents);
  const saved = await admin.from('square_checkout_attempts').update({ payload: { ...prepared.target.payload,
    sibling_refund: { id: refund.id, amount_cents: prepared.amountCents, status: refund.status, class_id: input.classId, person_id: input.personId, authorized_by: input.ownerId } } })
    .eq('id', prepared.target.id).eq('status', 'completed').select('id');
  return { refund_id: refund.id, status: refund.status, amount_cents: prepared.amountCents, registrations_unchanged: true, audit_saved: !saved.error && Boolean(saved.data?.length) };
}
