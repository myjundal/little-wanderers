import type { SupabaseClient } from '@supabase/supabase-js';
import { squareConfig, squareRequest, squareSiteUrl, assertSquarePaymentUrl, assertUsd, type SquareOrder } from '@/lib/square-client';
import { buildPrePopulatedData } from '@/lib/square';
import { CLASS_TERM_END_AT, CLASS_HOLIDAY_DATE } from '@/lib/class-config';

export type ClassCheckout = {
  id: string; household_id: string; kind: string; environment: string; location_id: string;
  expected_amount_cents: number; status: string; order_id: string | null; payment_url: string | null;
  payment_link_id: string | null; created_at: string; hold_expires_at: string;
  payload: {
    request: { person_id: string; items: Array<{ class_id: string; quantity: number }> };
    assignments: Array<{ class_id: string; person_id: string }>;
    line_items: Array<Record<string, unknown>>; provider_request?: Record<string, unknown>;
    summary?: { registration_ids: string[]; registration_count: number; total_price_cents: number };
  };
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function validCheckoutId(id: unknown): id is string { return typeof id === 'string' && uuid.test(id); }
export function classCheckoutRequest(body: { person_id?: unknown; items?: unknown }) {
  if (!validCheckoutId(body.person_id) || !Array.isArray(body.items) || !body.items.length || body.items.length > 30) throw new Error('Choose your child and at least one class date.');
  const ids: string[] = [];
  for (const item of body.items) {
    if (!item || !validCheckoutId(item.class_id) || (item.quantity !== undefined && item.quantity !== 1)) throw new Error('Choose one seat per date for the selected child.');
    ids.push(item.class_id.toLowerCase());
  }
  if (new Set(ids).size !== ids.length) throw new Error('Choose each class date only once.');
  return { person_id: body.person_id.toLowerCase(), items: ids.sort().map(class_id => ({ class_id, quantity: 1 })) };
}
function checked<T>(result: { data: T; error: { message: string } | null }): T { if (result.error) throw new Error(result.error.message); return result.data; }
function assertEnvironment(attempt: ClassCheckout) {
  const cfg = squareConfig();
  if (attempt.kind !== 'class' || attempt.environment !== cfg.environment || attempt.location_id !== cfg.locationId) throw new Error('Checkout environment mismatch');
  return cfg;
}
export async function readClassCheckout(db: SupabaseClient, householdId: string, id?: string) {
  let query = db.from('square_checkout_attempts').select('*').eq('household_id', householdId).eq('kind', 'class').eq('environment', squareConfig().environment);
  query = id ? query.eq('id', id) : query.in('status', ['creating', 'open', 'needs_review']);
  const attempt = checked(await query.order('created_at', { ascending: false }).limit(1).maybeSingle()) as ClassCheckout | null;
  if (attempt) assertEnvironment(attempt);
  return attempt;
}
const dateLabel = (start: string) => new Date(start).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** Server prices and atomic seat checks come from the installed prepare_square_checkout RPC. */
export async function startClassCheckout(db: SupabaseClient, input: { householdId: string; userId: string; email?: string; request: ReturnType<typeof classCheckoutRequest> }) {
  const cfg = squareConfig();
  const child = checked(await db.from('people').select('id').eq('id', input.request.person_id).eq('household_id', input.householdId).eq('role', 'child').maybeSingle());
  if (!child) throw new Error('Choose a child in your family.');
  const classes = checked(await db.from('classes').select('id,title,status,start_time,price_cents').in('id', input.request.items.map(item => item.class_id))) ?? [];
  if (classes.length !== input.request.items.length || classes.some(row => row.status !== 'scheduled' || Date.parse(row.start_time) <= Date.now() || Date.parse(row.start_time) >= Date.parse(CLASS_TERM_END_AT)
    || new Date(row.start_time).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }) === CLASS_HOLIDAY_DATE)) throw new Error('Choose an available upcoming class date through December 17.');
  if (classes.some(row => row.title === 'Little Hands, Big Canvases')) throw new Error('Use the separate five-session checkout for Ms. Jamie’s art series.');
  let attempt = checked(await db.rpc('prepare_square_checkout', {
    p_household: input.householdId, p_kind: 'class', p_environment: cfg.environment, p_location: cfg.locationId,
    p_user: input.userId, p_role: 'customer', p_request: input.request,
  })) as ClassCheckout;
  assertEnvironment(attempt);
  if (attempt.payload.assignments.length !== input.request.items.length || attempt.payload.assignments.some(row => row.person_id !== input.request.person_id)
    || attempt.expected_amount_cents !== classes.reduce((total, row) => total + row.price_cents, 0)) throw new Error('Class selection or price changed. Close the pending checkout and try again.');
  if (Date.parse(attempt.hold_expires_at) <= Date.now()) {
    await closeClassCheckout(db, attempt);
    throw new Error('Your checkout expired. Please select your dates again.');
  }
  if (attempt.payment_url) return attempt;
  const lines = input.request.items.map((item, index) => {
    const row = classes.find(c => c.id === item.class_id)!;
    return { ...attempt.payload.line_items[index], name: row.title, note: dateLabel(row.start_time) };
  });
  const providerRequest = {
    idempotency_key: `lw-class-${attempt.id}`,
    order: { location_id: cfg.locationId, reference_id: attempt.id, line_items: lines },
    checkout_options: { redirect_url: `${squareSiteUrl()}/landing/classschedule?checkout_id=${attempt.id}`, ask_for_shipping_address: false, allow_tipping: false, enable_coupon: false, enable_loyalty: false },
    ...(buildPrePopulatedData(input.email) ? { pre_populated_data: buildPrePopulatedData(input.email) } : {}),
    payment_note: `Little Wanderers class checkout ${attempt.id}`,
  };
  const frozen = checked(await db.rpc('freeze_square_checkout_request', { p_id: attempt.id, p_request: providerRequest }));
  const { payment_link: link } = await squareRequest<{ payment_link: { id: string; order_id: string; url: string } }>('/v2/online-checkout/payment-links', 'POST', frozen);
  const url = assertSquarePaymentUrl(link?.url);
  if (!link.order_id || !link.id) throw new Error('Square checkout is still being prepared. Please retry.');
  const { order } = await squareRequest<{ order: SquareOrder }>(`/v2/orders/${encodeURIComponent(link.order_id)}`);
  if (order.id !== link.order_id || order.location_id !== cfg.locationId || order.reference_id !== attempt.id) throw new Error('Checkout order mismatch');
  assertUsd(order.total_money, attempt.expected_amount_cents);
  attempt = checked(await db.from('square_checkout_attempts').update({ order_id: link.order_id, payment_link_id: link.id, payment_url: url, status: 'open' })
    .eq('id', attempt.id).in('status', ['creating', 'open']).select('*').single()) as ClassCheckout;
  return attempt;
}

type Payment = { id: string; order_id?: string; location_id?: string; status?: string; amount_money?: { amount?: number; currency?: string }; refunded_money?: { amount?: number }; tip_money?: { amount?: number }; created_at?: string; updated_at?: string };
/** Redirects, browser totals, and webhook payloads alone never prove payment. */
export async function reconcileClassCheckout(db: SupabaseClient, attempt: ClassCheckout) {
  const cfg = assertEnvironment(attempt);
  if (['completed', 'needs_review', 'cancelled'].includes(attempt.status) || !attempt.order_id) return attempt;
  const { order } = await squareRequest<{ order: SquareOrder }>(`/v2/orders/${encodeURIComponent(attempt.order_id)}`);
  if (order.id !== attempt.order_id || order.location_id !== cfg.locationId || order.reference_id !== attempt.id) throw new Error('Checkout order mismatch');
  assertUsd(order.total_money, attempt.expected_amount_cents);
  if (!order.tenders?.length) {
    if (order.state === 'CANCELED') return checked(await db.from('square_checkout_attempts').update({ status: 'cancelled' }).eq('id', attempt.id).in('status', ['creating', 'open']).select('*').single()) as ClassCheckout;
    return attempt;
  }
  if (!['OPEN', 'COMPLETED'].includes(order.state ?? '')) throw new Error('Payment needs review');
  const ids = order.tenders.map(t => t.payment_id);
  if (ids.some(id => !id) || new Set(ids).size !== ids.length) throw new Error('Payment receipts are required');
  const receipts: Payment[] = [];
  for (const id of ids) {
    const { payment } = await squareRequest<{ payment: Payment }>(`/v2/payments/${encodeURIComponent(id!)}`);
    if (payment.id !== id || payment.order_id !== order.id || payment.location_id !== cfg.locationId || payment.status !== 'COMPLETED'
      || payment.amount_money?.currency !== 'USD' || !Number.isSafeInteger(payment.amount_money.amount) || payment.amount_money.amount! <= 0
      || (payment.refunded_money?.amount ?? 0) !== 0 || (payment.tip_money?.amount ?? 0) !== 0
      || !payment.updated_at || !Number.isFinite(Date.parse(payment.updated_at)) || !payment.created_at || !Number.isFinite(Date.parse(payment.created_at))
      || Date.parse(payment.created_at) < Date.parse(attempt.created_at) - 60_000) throw new Error('Payment needs review');
    receipts.push(payment);
  }
  assertUsd(order.net_amount_due_money, 0);
  if (receipts.reduce((sum, receipt) => sum + receipt.amount_money!.amount!, 0) !== attempt.expected_amount_cents) throw new Error('Paid amount does not match');
  for (const payment of receipts) checked(await db.rpc('save_square_payment_receipt', {
    p_environment: cfg.environment, p_payment: payment.id, p_order: order.id, p_amount: payment.amount_money!.amount!,
    p_refunded: 0, p_status: 'COMPLETED', p_updated: payment.updated_at,
  }));
  try { checked(await db.rpc('fulfill_square_class_checkout', { p_id: attempt.id })); }
  catch (error) {
    // Keep a verified payment with a registration conflict visible for staff; never prompt another charge.
    checked(await db.from('square_checkout_attempts').update({ status: 'needs_review' }).eq('id', attempt.id).in('status', ['creating', 'open']).select('id'));
    console.error('class_checkout_fulfillment_review', attempt.id, error instanceof Error ? error.message : 'Fulfillment failed');
  }
  return checked(await db.from('square_checkout_attempts').select('*').eq('id', attempt.id).single()) as ClassCheckout;
}

/** Close the live Square page before releasing temporary checkout capacity. */
export async function closeClassCheckout(db: SupabaseClient, attempt: ClassCheckout) {
  const cfg = assertEnvironment(attempt);
  if (['completed', 'needs_review', 'cancelled'].includes(attempt.status)) return attempt;
  if (!attempt.order_id) {
    if (!attempt.payload.provider_request) {
      checked(await db.rpc('abandon_uncreated_square_checkout', { p_id: attempt.id }));
      return checked(await db.from('square_checkout_attempts').select('*').eq('id', attempt.id).single()) as ClassCheckout;
    }
    // Recover an ambiguous creation using the exact stored idempotent request.
    const { payment_link: link } = await squareRequest<{ payment_link: { id: string; order_id: string; url: string } }>('/v2/online-checkout/payment-links', 'POST', attempt.payload.provider_request);
    assertSquarePaymentUrl(link?.url);
    if (!link.id || !link.order_id) throw new Error('Checkout is still being prepared. Please try again.');
    attempt = checked(await db.from('square_checkout_attempts').update({ order_id: link.order_id, payment_link_id: link.id, payment_url: link.url, status: 'open' }).eq('id', attempt.id).in('status', ['creating', 'open']).select('*').single()) as ClassCheckout;
  }
  const current = await reconcileClassCheckout(db, attempt);
  if (['completed', 'needs_review', 'cancelled'].includes(current.status)) return current;
  const { order: before } = await squareRequest<{ order: SquareOrder }>(`/v2/orders/${encodeURIComponent(attempt.order_id!)}`);
  if (before.tenders?.length) throw new Error('Payment is in progress. Please check your payment before changing dates.');
  if (before.state !== 'CANCELED') {
    if (!attempt.payment_link_id) throw new Error('Checkout is still being prepared. Please try again.');
    try { await squareRequest(`/v2/online-checkout/payment-links/${encodeURIComponent(attempt.payment_link_id)}`, 'DELETE'); } catch { /* Re-read the order after an uncertain delete. */ }
  }
  const { order } = await squareRequest<{ order: SquareOrder }>(`/v2/orders/${encodeURIComponent(attempt.order_id!)}`);
  if (order.id !== attempt.order_id || order.location_id !== cfg.locationId || order.reference_id !== attempt.id || order.state !== 'CANCELED' || order.tenders?.length) throw new Error('Payment has not closed yet. Refresh to check before paying again.');
  return checked(await db.from('square_checkout_attempts').update({ status: 'cancelled' }).eq('id', attempt.id).in('status', ['creating', 'open']).select('*').single()) as ClassCheckout;
}
let nextCleanupAt = 0;
export async function cleanupClassCheckouts(db: SupabaseClient) {
  if (Date.now() < nextCleanupAt) return;
  nextCleanupAt = Date.now() + 30_000;
  const rows = checked(await db.from('square_checkout_attempts').select('*').eq('kind', 'class').eq('environment', squareConfig().environment)
    .in('status', ['creating', 'open']).lte('hold_expires_at', new Date().toISOString()).order('hold_expires_at').limit(6)) as ClassCheckout[];
  await Promise.allSettled(rows.map(async row => {
    try { await closeClassCheckout(db, row); } catch (error) { console.error('class_checkout_cleanup_pending', row.id, error instanceof Error ? error.message : 'Verification pending'); }
  }));
}
export function publicClassCheckout(attempt: ClassCheckout | null) {
  return attempt ? { id: attempt.id, status: attempt.status, payment_url: attempt.payment_url ? assertSquarePaymentUrl(attempt.payment_url) : null,
    total_price_cents: attempt.expected_amount_cents, person_id: attempt.payload.request.person_id,
    class_ids: attempt.payload.request.items.map(item => item.class_id), expires_at: attempt.hold_expires_at, summary: attempt.payload.summary ?? null } : null;
}
