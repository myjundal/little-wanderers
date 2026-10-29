import type { SupabaseClient } from '@supabase/supabase-js';
import { assertSquarePaymentUrl, assertUsd, requirePaymentFlow, squareConfig, squareRequest, squareSiteUrl,
  type SquareOrder, type SquareMoney, type SquareInvoice } from '@/lib/square-client';
import { buildPrePopulatedData } from '@/lib/square';
import { toPartyDateTimeIso } from '@/lib/party-config';

export type CheckoutAttempt = {
  id: string; household_id: string; kind: 'membership' | 'class'; environment: string; location_id: string;
  expected_amount_cents: number; status: string; order_id: string | null; payment_url: string | null;
  payment_link_id: string | null; square_subscription_id: string | null; created_at: string;
  payload: { request: { person_id?: string; items?: Array<{ class_id: string; quantity: number }>; plan_variation_id?: string }; summary?: unknown; line_items?: Array<Record<string, unknown>>; provider_request?: Record<string, unknown> };
};
export type SquarePayment = {
  id: string; order_id?: string; location_id?: string; customer_id?: string; status?: string;
  amount_money?: SquareMoney; refunded_money?: SquareMoney;
  updated_at?: string;
};
export type SquareSubscription = {
  id: string; customer_id: string; location_id: string; plan_variation_id: string; status: string;
  version: number; invoice_ids?: string[]; charged_through_date?: string; created_at?: string;
  canceled_date?: string; actions?: Array<{ id: string; type: string; effective_date?: string }>;
};

export async function startSquareCheckout(admin: SupabaseClient, input: {
  householdId: string; userId: string; role: string; kind: 'membership' | 'class'; email?: string | null;
  personId?: string; items?: Array<{ class_id: string; quantity?: number }>; returnPath: string;
}) {
  const config = requirePaymentFlow(input.kind);
  let request: CheckoutAttempt['payload']['request'];
  if (input.kind === 'membership') {
    const plan = process.env.SQUARE_PLAN_VARIATION_ID;
    if (!plan) throw new Error('Membership plan variation is not configured');
    const { object } = await squareRequest<{ object: { type: string; is_deleted?: boolean; subscription_plan_variation_data?: {
      phases?: Array<{ cadence?: string; recurring_price_money?: SquareMoney; pricing?: { type?: string; price_money?: SquareMoney } }>
    } } }>(`/v2/catalog/object/${encodeURIComponent(plan)}`);
    const phases = object.subscription_plan_variation_data?.phases ?? [];
    if (object.type !== 'SUBSCRIPTION_PLAN_VARIATION' || object.is_deleted || phases.length !== 1 || phases[0].cadence !== 'MONTHLY') {
      throw new Error('Configure a single-phase monthly subscription plan variation');
    }
    assertUsd(phases[0].pricing?.price_money ?? phases[0].recurring_price_money, 6000);
    request = { plan_variation_id: plan };
  } else {
    const items = new Map<string, number>();
    for (const item of input.items ?? []) {
      const quantity = Number(item.quantity ?? 1);
      if (!item.class_id || !Number.isInteger(quantity) || quantity < 1 || quantity > 30) throw new Error('Invalid class quantity');
      items.set(item.class_id, (items.get(item.class_id) ?? 0) + quantity);
    }
    if (!input.personId || items.size === 0) throw new Error('person_id and items are required');
    request = { person_id: input.personId, items: [...items].sort(([a],[b]) => a.localeCompare(b)).map(([class_id,quantity]) => ({ class_id,quantity })) };
  }
  const { data, error } = await admin.rpc('prepare_square_checkout', {
    p_household: input.householdId, p_kind: input.kind, p_environment: config.environment, p_location: config.locationId,
    p_user: input.userId, p_role: input.role, p_request: request,
  });
  if (error) throw new Error(error.message);
  const attempt = data as CheckoutAttempt;
  if (attempt.payment_url) return { id: attempt.id, url: assertSquarePaymentUrl(attempt.payment_url), total: attempt.expected_amount_cents };
  const redirect = new URL(input.returnPath, squareSiteUrl());
  redirect.searchParams.set('checkout_id', attempt.id);
  const providerRequest = {
    idempotency_key: `lw-checkout-${attempt.id}`,
    ...(input.kind === 'membership' ? { quick_pay: {
      name: 'Little Wanderers Monthly Membership', location_id: config.locationId,
      price_money: { amount: attempt.expected_amount_cents, currency: 'USD' },
    } } : { order: { location_id: config.locationId, reference_id: attempt.id, line_items: attempt.payload.line_items } }),
    checkout_options: { redirect_url: redirect.toString(), ask_for_shipping_address: false, allow_tipping: false,
      ...(input.kind === 'membership' ? { subscription_plan_id: request.plan_variation_id } : {}) },
    ...(buildPrePopulatedData(input.email) ? { pre_populated_data: buildPrePopulatedData(input.email) } : {}),
    payment_note: `Little Wanderers checkout ${attempt.id}`,
  };
  // Persist the entire provider request once, so retries keep the same price, return URL and idempotency body.
  const { data: frozen, error: freezeError } = await admin.rpc('freeze_square_checkout_request', { p_id: attempt.id, p_request: providerRequest });
  if (freezeError) throw new Error(freezeError.message);
  const result = await squareRequest<{ payment_link: { id: string; order_id: string; url: string } }>('/v2/online-checkout/payment-links', 'POST', frozen);
  const link = result.payment_link;
  const url = assertSquarePaymentUrl(link?.url);
  if (!link.order_id) throw new Error('Square checkout order is missing');
  const { order } = await squareRequest<{ order: SquareOrder }>(`/v2/orders/${encodeURIComponent(link.order_id)}`);
  assertUsd(order.total_money, attempt.expected_amount_cents);
  if (order.location_id !== config.locationId) throw new Error('Checkout location mismatch');
  const { error: saveError } = await admin.from('square_checkout_attempts').update({
    order_id: link.order_id, payment_link_id: link.id, payment_url: url, status: 'open',
  }).eq('id', attempt.id);
  if (saveError) throw new Error(saveError.message);
  return { id: attempt.id, url, total: attempt.expected_amount_cents };
}

export async function verifyCheckoutOrder(attempt: CheckoutAttempt) {
  const config = squareConfig();
  if (attempt.environment !== config.environment || attempt.location_id !== config.locationId || !attempt.order_id) throw new Error('Checkout environment mismatch');
  const { order } = await squareRequest<{ order: SquareOrder }>(`/v2/orders/${encodeURIComponent(attempt.order_id)}`);
  if (order.id !== attempt.order_id || order.location_id !== config.locationId) throw new Error('Checkout order mismatch');
  assertUsd(order.total_money, attempt.expected_amount_cents);
  // Hosted checkout can leave a fully paid order OPEN while its digital fulfillment is still proposed.
  if (!['OPEN','COMPLETED'].includes(order.state ?? '') || !(order.tenders?.length)) return { paid: false as const, order, payments: [] as SquarePayment[] };
  const payments: SquarePayment[] = [];
  for (const tender of order.tenders ?? []) {
    if (!tender.payment_id) throw new Error('Checkout payment evidence is missing');
    const { payment } = await squareRequest<{ payment: SquarePayment }>(`/v2/payments/${encodeURIComponent(tender.payment_id)}`);
    if (payment.order_id !== order.id || payment.location_id !== config.locationId || payment.status !== 'COMPLETED'
      || payment.amount_money?.currency !== 'USD' || !Number.isSafeInteger(payment.amount_money.amount)
      || (payment.refunded_money?.amount ?? 0) !== 0) throw new Error('Checkout payment requires review');
    payments.push(payment);
  }
  const total = payments.reduce((sum,payment) => sum + payment.amount_money!.amount!, 0);
  if (total !== attempt.expected_amount_cents) throw new Error('Checkout paid amount does not match');
  return { paid: true as const, order, payments };
}

export async function cancelUnpaidClassCheckout(admin: SupabaseClient, attempt: CheckoutAttempt) {
  if (attempt.kind !== 'class') throw new Error('Only unpaid class checkouts can be cancelled here');
  if (attempt.status === 'cancelled') return {status:'cancelled'};
  if (!['creating','open'].includes(attempt.status)) throw new Error('This payment requires staff review');
  const verified = await verifyCheckoutOrder(attempt);
  if (verified.paid) return reconcileCheckout(admin,attempt);
  if (verified.order.tenders?.length) throw new Error('Payment is in progress; please contact staff');
  if (verified.order.state !== 'CANCELED') {
    if (!attempt.payment_link_id) throw new Error('Checkout is still being prepared; please retry the original class');
    try {
      await squareRequest(`/v2/online-checkout/payment-links/${encodeURIComponent(attempt.payment_link_id)}`, 'DELETE');
    } catch {
      // A retry may find an already deleted link. Only the current order proves it is safe to release seats.
    }
  }
  const {order} = await squareRequest<{order:SquareOrder}>(`/v2/orders/${encodeURIComponent(attempt.order_id!)}`);
  if (order.id!==attempt.order_id || order.location_id!==attempt.location_id || order.state!=='CANCELED' || order.tenders?.length) {
    throw new Error('Square has not confirmed cancellation; your checkout is still reserved');
  }
  const {error} = await admin.from('square_checkout_attempts').update({status:'cancelled'})
    .eq('id',attempt.id).in('status',['creating','open']);
  if (error) throw new Error(error.message);
  return {status:'cancelled'};
}

export async function reconcileCheckout(admin: SupabaseClient, attempt: CheckoutAttempt) {
  const verified = await verifyCheckoutOrder(attempt);
  if (!verified.paid) {
    if (verified.order.state === 'CANCELED') {
      const { error } = await admin.from('square_checkout_attempts').update({ status:'cancelled' }).eq('id',attempt.id);
      if (error) throw new Error(error.message);
      return { status:'cancelled',checkout_summary:null };
    }
    return { status: 'pending', checkout_summary: null };
  }
  for (const payment of verified.payments) {
    await saveSquarePaymentReceipt(admin,payment);
  }
  if (attempt.kind === 'class') {
    const { data, error } = await admin.rpc('fulfill_square_class_checkout', { p_id: attempt.id });
    if (error) throw new Error(error.message);
    return { status: 'completed', checkout_summary: data };
  }
  const recipient = verified.order.fulfillments?.map(f => f.digital_details?.recipient ?? f.pickup_details?.recipient).find(Boolean);
  let customerId = verified.order.customer_id || verified.payments.find(p => p.customer_id)?.customer_id
    || verified.order.tenders?.find(t => t.customer_id)?.customer_id || recipient?.customer_id;
  if (!customerId && (recipient?.phone_number || recipient?.email_address)) {
    // Square's subscription checkout resolves its customer by the phone entered on the hosted page.
    // This recipient comes from the authenticated, already-paid order, never from a browser callback or auth-email guess.
    const filter = recipient.phone_number ? { phone_number: { exact: recipient.phone_number } } : { email_address: { exact: recipient.email_address } };
    const { customers } = await squareRequest<{ customers?: Array<{ id: string }> }>('/v2/customers/search','POST',{query:{filter},limit:100});
    if (customers?.length === 1) customerId = customers[0].id;
  }
  if (!customerId) throw new Error('Waiting for Square subscription customer mapping');
  const { data: other, error: otherError } = await admin.from('square_customers').select('household_id')
    .eq('environment', attempt.environment).eq('square_customer_id', customerId).maybeSingle();
  if (otherError) throw new Error(otherError.message);
  if (other && other.household_id !== attempt.household_id) throw new Error('Subscription customer belongs to another household');
  // The hosted subscription checkout can choose/create a Square customer. Bind using its verified order, never buyer email.
  const { subscriptions } = await squareRequest<{ subscriptions?: SquareSubscription[] }>('/v2/subscriptions/search', 'POST', {
    query: { filter: { customer_ids: [customerId], location_ids: [attempt.location_id] } }, limit: 100,
  });
  const candidates = (subscriptions ?? []).filter(sub => sub.plan_variation_id === attempt.payload.request.plan_variation_id
    && sub.created_at && new Date(sub.created_at).getTime() >= new Date(attempt.created_at).getTime() - 60_000
    && (!attempt.square_subscription_id || sub.id === attempt.square_subscription_id));
  if (candidates.length !== 1) throw new Error('Waiting for an unambiguous Square subscription');
  const sub = candidates[0];
  const { error: saveError } = await admin.from('square_checkout_attempts').update({ square_subscription_id: sub.id }).eq('id', attempt.id);
  if (saveError) throw new Error(saveError.message);
  await reconcileMembership(admin, { ...attempt, square_subscription_id: sub.id }, sub);
  return { status: 'completed', checkout_summary: null };
}

export async function saveSquarePaymentReceipt(admin: SupabaseClient,payment: SquarePayment) {
  const config = squareConfig();
  if (!payment.order_id || payment.location_id !== config.locationId || payment.amount_money?.currency !== 'USD'
    || !Number.isSafeInteger(payment.amount_money.amount) || !payment.updated_at || !Number.isFinite(Date.parse(payment.updated_at))) {
    throw new Error('Invalid Square payment receipt');
  }
  const { error } = await admin.rpc('save_square_payment_receipt',{
    p_environment:config.environment,p_payment:payment.id,p_order:payment.order_id,p_amount:payment.amount_money.amount,
    p_refunded:payment.refunded_money?.amount ?? 0,p_status:payment.status,p_updated:payment.updated_at,
  });
  if (error) throw new Error(error.message);
}

export async function reconcileMembership(admin: SupabaseClient, attempt: CheckoutAttempt, knownSubscription?: SquareSubscription, triggerInvoice?: SquareInvoice) {
  const config = squareConfig();
  if (attempt.environment !== config.environment || !attempt.square_subscription_id) throw new Error('Subscription mapping is missing');
  const sub = knownSubscription ?? (await squareRequest<{ subscription: SquareSubscription }>(`/v2/subscriptions/${encodeURIComponent(attempt.square_subscription_id)}`)).subscription;
  if (sub.id !== attempt.square_subscription_id || sub.location_id !== config.locationId
    || sub.plan_variation_id !== attempt.payload.request.plan_variation_id) throw new Error('Subscription does not match checkout');
  if (triggerInvoice && (triggerInvoice.subscription_id !== sub.id || triggerInvoice.location_id !== config.locationId
    || triggerInvoice.primary_recipient?.customer_id !== sub.customer_id)) throw new Error('Subscription invoice event does not match');
  const invoiceIds = sub.invoice_ids ?? [];
  let latest: SquareInvoice | undefined;
  // Square returns newest invoice IDs first. Always retrieve current provider state.
  for (const id of invoiceIds.slice(0, 1)) {
    const { invoice } = await squareRequest<{ invoice: SquareInvoice }>(`/v2/invoices/${encodeURIComponent(id)}`);
    if (invoice.location_id !== config.locationId || invoice.primary_recipient?.customer_id !== sub.customer_id
      || invoice.subscription_id !== sub.id) throw new Error('Subscription invoice mapping mismatch');
    if (!latest || (invoice.payment_requests?.[0]?.due_date ?? '') >= (latest.payment_requests?.[0]?.due_date ?? '')) latest = invoice;
  }
  const requests = latest?.payment_requests ?? [];
  const paid = latest?.status === 'PAID' && requests.reduce((sum,r) => sum + (r.total_completed_amount_money?.amount ?? 0), 0) === attempt.expected_amount_cents
    && requests.every(r => r.total_completed_amount_money?.currency === 'USD');
  const review = [latest,triggerInvoice].some(invoice => invoice && ['REFUNDED','PARTIALLY_REFUNDED'].includes(invoice.status ?? ''));
  const throughDate = sub.charged_through_date;
  let paidThrough: string | null = null;
  const dueDate = requests[0]?.due_date;
  if (paid && throughDate && dueDate && /^\d{4}-\d{2}-\d{2}$/.test(throughDate) && /^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
    // charged_through_date means invoiced, not paid. An older paid invoice must not unlock a newer unpaid cycle.
    const [year,month,day] = dueDate.split('-').map(Number);
    const lastDayOfNextMonth = new Date(Date.UTC(year,month+1,0)).getUTCDate();
    const nextBillingDate = new Date(Date.UTC(year,month,Math.min(day,lastDayOfNextMonth),12));
    nextBillingDate.setUTCDate(nextBillingDate.getUTCDate()-1);
    const boundedThrough = [throughDate,nextBillingDate.toISOString().slice(0,10)].sort()[0];
    const nextDay = new Date(`${boundedThrough}T12:00:00Z`);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    paidThrough = toPartyDateTimeIso(nextDay.toISOString().slice(0,10),0);
  }
  const { error } = await admin.rpc('apply_square_membership', {
    p_attempt: attempt.id, p_subscription: sub.id, p_customer: sub.customer_id, p_status: sub.status,
    p_version: sub.version, p_paid_through: paidThrough, p_review: review,
  });
  if (error) throw new Error(error.message);
}

export async function changeSquareMembership(admin: SupabaseClient, householdId: string, action: 'pause' | 'resume' | 'cancel') {
  const config = requirePaymentFlow('membership');
  const { data: attempt, error } = await admin.from('square_checkout_attempts').select('*').eq('household_id', householdId)
    .eq('kind','membership').eq('environment', config.environment).not('square_subscription_id','is',null)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  if (!attempt) throw new Error('No linked Square subscription; manual review is required');
  const path = `/v2/subscriptions/${encodeURIComponent(attempt.square_subscription_id)}`;
  let { subscription } = await squareRequest<{ subscription: SquareSubscription }>(`${path}?include=actions`);
  const pendingPause = subscription.actions?.find(a => a.type === 'PAUSE');
  if (action === 'resume' && subscription.status === 'ACTIVE' && pendingPause) {
    ({ subscription } = await squareRequest<{ subscription: SquareSubscription }>(`${path}/actions/${encodeURIComponent(pendingPause.id)}`, 'DELETE'));
  } else if (!((action === 'pause' && (subscription.status === 'PAUSED' || pendingPause))
    || (action === 'resume' && subscription.status === 'ACTIVE')
    || (action === 'cancel' && (subscription.status === 'CANCELED' || subscription.canceled_date)))) {
    ({ subscription } = await squareRequest<{ subscription: SquareSubscription }>(`${path}/${action}`, 'POST',
      action === 'resume' ? { resume_change_timing: 'IMMEDIATE' } : {}));
  }
  // Pause/cancel can be scheduled for a billing boundary. Preserve access already paid for.
  await reconcileMembership(admin, attempt as CheckoutAttempt, subscription);
  return { status: subscription.status };
}
