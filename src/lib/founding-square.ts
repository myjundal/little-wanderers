import { foundingBillingDetails, freezeFoundingSquareStart, verifyFoundingBillingCard } from '@/lib/founding-billing-activation';
import { COMPLIMENTARY_MEMBERSHIP_MESSAGE, readComplimentaryMembership } from '@/lib/complimentary-membership';
import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { squareConfig, squareEnvironment, squareRequest } from '@/lib/square-client';
import { addMonths, easternDate, foundingMonthlyCents, foundingPhases, isDate, MEMBERSHIP_PRICES, FOUNDING_TERMS_VERSION, type FoundingEnrollment } from '@/lib/founding-membership';

type Card = { id: string; customer_id?: string; enabled?: boolean; reference_id?: string; card_brand?: string; last_4?: string };
type AnchorAction = { type?: string; effective_date?: string; monthly_billing_anchor_date?: number };
type Subscription = { monthly_billing_anchor_date?: number; id: string; customer_id?: string; location_id?: string; card_id?: string; start_date?: string; status?: string; canceled_date?: string; charged_through_date?: string; invoice_ids?: string[] };

export function foundingCardConfig(databaseEnabled = false) {
  const config = squareConfig();
  const applicationId = process.env.SQUARE_APPLICATION_ID || process.env.NEXT_PUBLIC_SQUARE_APPLICATION_ID;
  if (!(databaseEnabled || process.env.FOUNDING_CARD_ENROLLMENT_ENABLED === 'true') || !applicationId) throw new Error('Card registration will be available soon. No payment is due today.');
  return { ...config, applicationId };
}

export async function updateFounding(admin: SupabaseClient, id: string, patch: Record<string, unknown>) {
  const result = await admin.from('founding_memberships').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id);
  if (result.error) throw new Error('Unable to save membership status. Please retry.');
}

async function claim(admin: SupabaseClient, enrollment: FoundingEnrollment, next: string, startDate?: string) {
  const result = await admin.rpc('claim_founding_operation', { p_id: enrollment.id, p_from: enrollment.status, p_to: next, p_start: startDate ?? null });
  if (result.error || !result.data?.id) throw new Error('Your membership is being updated. Please refresh and retry.');
  return result.data as FoundingEnrollment;
}

/** This function only creates a customer and a card. It cannot charge or subscribe. */
export async function storeFoundingCard(admin: SupabaseClient, enrollment: FoundingEnrollment, sourceId: string, contact: { email: string; firstName: string; lastName: string; phone: string }, databaseEnabled = false) {
  const config = foundingCardConfig(databaseEnabled);
  if (enrollment.environment !== config.environment) throw new Error('Square environment mismatch.');
  if (enrollment.status === 'pending') return enrollment;
  if (!['draft', 'saving_card'].includes(enrollment.status)) throw new Error('This membership cannot be enrolled again.');
  if (enrollment.status === 'draft') enrollment = await claim(admin, enrollment, 'saving_card');

  let customerId = enrollment.square_customer_id;
  if (!customerId) {
    const result = await squareRequest<{ customer: { id: string } }>('/v2/customers', 'POST', {
      idempotency_key: `fcus-${enrollment.id}`, reference_id: enrollment.id,
      email_address: contact.email, given_name: contact.firstName, family_name: contact.lastName, phone_number: contact.phone,
    });
    if (!result.customer?.id) throw new Error('Square could not save your customer profile.');
    customerId = result.customer.id;
    await updateFounding(admin, enrollment.id, { square_customer_id: customerId });
  }
  // Recover a successful provider write even if the earlier response/local save was lost.
  let card: Card | undefined;
  let cursor: string | undefined;
  do {
    const query = new URLSearchParams({ customer_id: customerId, ...(cursor ? { cursor } : {}) });
    const result = await squareRequest<{ cards?: Card[]; cursor?: string }>(`/v2/cards?${query}`);
    card = result.cards?.find(item => item.reference_id === enrollment.id && item.enabled !== false && item.customer_id === customerId);
    cursor = result.cursor;
  } while (!card && cursor);
  if (!card) {
    const result = await squareRequest<{ card: Card }>('/v2/cards', 'POST', {
      idempotency_key: createHash('sha256').update(`${enrollment.id}:${sourceId}`).digest('hex').slice(0, 45),
      source_id: sourceId,
      card: { customer_id: customerId, cardholder_name: `${contact.firstName} ${contact.lastName}`, reference_id: enrollment.id },
    });
    card = result.card;
  }
  if (!card?.id || card.customer_id !== customerId || card.enabled === false) throw new Error('Square could not save your card. Please try another card.');
  const patch = { status: 'pending', square_customer_id: customerId, square_card_id: card.id, card_brand: card.card_brand ?? null, card_last4: card.last_4 ?? null };
  const saved = await admin.from('founding_memberships').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', enrollment.id).eq('status', 'saving_card').select('id').maybeSingle();
  if (saved.error || !saved.data) throw new Error('Unable to confirm your reservation. Please refresh and retry.');
  return { ...enrollment, ...patch };
}

/** Only an owner route can call this, with a deliberately chosen date and a separate closed-by-default flag. */
export async function activateFounding(admin: SupabaseClient, enrollment: FoundingEnrollment, startDate: string, options: { ownerAuthorized?: boolean; ownerUserId?: string } = {}) {
  const config = squareConfig();
  if (process.env.FOUNDING_BILLING_ENABLED !== 'true' && options.ownerAuthorized !== true) throw new Error('Billing is disabled. No subscriptions or charges have been created.');
  if (!isDate(startDate) || startDate > easternDate() || (enrollment.status === 'activating' && enrollment.start_date !== startDate)) throw new Error('Choose the verified first membership visit day; retry with the originally confirmed date.');
  if (enrollment.terms_version !== FOUNDING_TERMS_VERSION) throw new Error('The family must accept the current first-visit billing terms before activation.');
  if (enrollment.environment !== config.environment || !enrollment.square_card_id || !enrollment.square_customer_id) throw new Error('A saved card in the current Square environment is required.');
  if (['scheduled', 'active'].includes(enrollment.status)) return enrollment;
  if (!['pending', 'activating'].includes(enrollment.status)) throw new Error('Only reserved memberships can be started.');
  if (await readComplimentaryMembership(admin, enrollment.household_id)) throw new Error(COMPLIMENTARY_MEMBERSHIP_MESSAGE);
  if (enrollment.status === 'pending' && startDate !== easternDate()) {
    if (!options.ownerUserId) throw Error('Choose the verified first membership visit day.');
    const details = await foundingBillingDetails(admin, enrollment);
    if (details.error || details.start_date !== startDate || !options.ownerUserId) throw new Error(details.error || 'Choose the verified first membership visit day.');
  }
  await verifyFoundingBillingCard(enrollment);
  const wasPending = enrollment.status === 'pending';
  if (enrollment.status === 'pending') {
    // Freeze the start date before any external subscription call; retries cannot move it.
    enrollment = await claim(admin, enrollment, 'activating', startDate);
  }
  if (!enrollment.start_date || enrollment.start_date !== startDate) throw new Error('Retry using the originally confirmed first-visit date.');
  const squareStartDate = options.ownerUserId ? await freezeFoundingSquareStart(admin, enrollment, options.ownerUserId, wasPending ? easternDate() : startDate) : startDate;
  const phases = foundingPhases(enrollment.birthdates, startDate, enrollment.pricing_tier).map((phase, ordinal) => ({ ...phase, ordinal }));
  const plan = await squareRequest<{ catalog_object: { id: string } }>('/v2/catalog/object', 'POST', {
    idempotency_key: `fp-${enrollment.id}`, object: { type: 'SUBSCRIPTION_PLAN', id: '#founding-plan', present_at_all_locations: true, subscription_plan_data: { name: enrollment.pricing_tier === 'regular' ? 'Little Wanderers Monthly Membership' : 'Little Wanderers Founding Membership', all_items: true } },
  });
  const variation = await squareRequest<{ catalog_object: { id: string } }>('/v2/catalog/object', 'POST', {
    idempotency_key: `fv-${enrollment.id}`, object: { type: 'SUBSCRIPTION_PLAN_VARIATION', id: '#founding-monthly', present_at_all_locations: true, subscription_plan_variation_data: { name: MEMBERSHIP_PRICES[enrollment.pricing_tier].label, subscription_plan_id: plan.catalog_object.id, can_prorate: false, phases } },
  });
  const result = await squareRequest<{ subscription: Subscription }>('/v2/subscriptions', 'POST', {
    idempotency_key: `fs-${enrollment.id}`, location_id: config.locationId,
    customer_id: enrollment.square_customer_id, card_id: enrollment.square_card_id,
    plan_variation_id: variation.catalog_object.id, start_date: squareStartDate, timezone: 'America/New_York',
    monthly_billing_anchor_date: Number(squareStartDate.slice(8)),
  });
  if (!result.subscription?.id || result.subscription.start_date !== squareStartDate || result.subscription.customer_id !== enrollment.square_customer_id) throw new Error('Unable to verify the Square subscription. Retry with the same first-visit date.');
  if (squareStartDate !== startDate) {
    await updateFounding(admin, enrollment.id, { square_subscription_id: result.subscription.id });
    await alignHistoricalBilling(enrollment, result.subscription.id, startDate);
    await updateFounding(admin, enrollment.id, { paid_through: addMonths(startDate, 1) });
  }
  const patch = { square_subscription_id: result.subscription.id, status: 'active', amount_cents: foundingMonthlyCents(enrollment.birthdates, startDate, enrollment.pricing_tier) };
  await updateFounding(admin, enrollment.id, patch);
  return { ...enrollment, ...patch };
}

/** A delayed first activation charges one full month today, then restores the first-visit renewal day. */
async function alignHistoricalBilling(enrollment: FoundingEnrollment, subscriptionId: string, firstVisit: string) {
  let subscription: Subscription | undefined;
  let actions: AnchorAction[] = [];
  for (let attempt = 0; attempt < 4; attempt++) {
    const state = await squareRequest<{ subscription: Subscription; actions?: AnchorAction[] }>(`/v2/subscriptions/${encodeURIComponent(subscriptionId)}?include=actions`);
    subscription = state.subscription; actions = state.actions ?? [];
    if (subscription.invoice_ids?.length) break;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  const invoiceId = subscription?.invoice_ids?.at(-1);
  if (!invoiceId) throw Error('Square is preparing the first payment. Retry this same activation shortly; do not create a separate subscription.');
  const { invoice } = await squareRequest<{ invoice: { subscription_id?: string; primary_recipient?: { customer_id?: string }; status?: string; payment_requests?: Array<{ computed_amount_money?: { amount?: number; currency?: string }; total_completed_amount_money?: { amount?: number; currency?: string } }> } }>(`/v2/invoices/${encodeURIComponent(invoiceId)}`);
  const expected = foundingMonthlyCents(enrollment.birthdates, firstVisit, enrollment.pricing_tier);
  const requests = invoice.payment_requests ?? [];
  if (invoice.subscription_id !== subscriptionId || invoice.primary_recipient?.customer_id !== enrollment.square_customer_id || requests.length !== 1 || requests[0].computed_amount_money?.currency !== 'USD' || requests[0].computed_amount_money.amount !== expected) throw Error('The first invoice needs review. No additional subscription has been requested.');
  if (invoice.status !== 'PAID' || requests[0].total_completed_amount_money?.currency !== 'USD' || requests[0].total_completed_amount_money.amount !== expected) throw Error('The first payment is not confirmed yet. Retry this same activation after Square confirms payment.');
  const anchor = Number(firstVisit.slice(8));
  const scheduled = (items: AnchorAction[]) => items.some(a => a.type === 'CHANGE_BILLING_ANCHOR_DATE' && a.monthly_billing_anchor_date === anchor && a.effective_date === addMonths(firstVisit, 1));
  if (subscription?.monthly_billing_anchor_date !== anchor && !scheduled(actions)) {
    const changed = await squareRequest<{ subscription: Subscription; actions?: AnchorAction[] }>(`/v2/subscriptions/${encodeURIComponent(subscriptionId)}/billing-anchor`, 'POST', { monthly_billing_anchor_date: anchor });
    if (changed.subscription?.monthly_billing_anchor_date !== anchor && !scheduled(changed.actions ?? [])) throw Error('The first payment is recorded, but the renewal date needs confirmation. Retry this same activation.');
  }
}

export async function cancelFounding(admin: SupabaseClient, enrollment: FoundingEnrollment) {
  if (enrollment.environment !== squareEnvironment()) throw new Error('Square environment mismatch.');
  if (enrollment.status === 'canceled') return;
  if (enrollment.status === 'activating') throw new Error('Your membership is being started. Please refresh and retry cancellation.');
  if (enrollment.status !== 'canceling') enrollment = await claim(admin, enrollment, 'canceling');
  if (enrollment.square_subscription_id) {
    const config = squareConfig();
    const id = encodeURIComponent(enrollment.square_subscription_id);
    const { subscription } = await squareRequest<{ subscription: Subscription }>(`/v2/subscriptions/${id}`);
    if (subscription.customer_id !== enrollment.square_customer_id || subscription.location_id !== config.locationId) throw new Error('Unable to verify this subscription.');
    if (subscription.status !== 'CANCELED' && !subscription.canceled_date) {
      await squareRequest(`/v2/subscriptions/${id}/cancel`, 'POST');
    }
  }
  await updateFounding(admin, enrollment.id, { status: 'canceled', canceled_at: new Date().toISOString() });
}

/** Read provider state, never trust a webhook's claimed amount or status. */
export async function syncFoundingSubscription(admin: SupabaseClient, subscriptionId: string) {
  const config = squareConfig();
  const row = await admin.from('founding_memberships').select('*').eq('square_subscription_id', subscriptionId).eq('environment', config.environment).maybeSingle();
  if (row.error) throw new Error('Unable to resolve membership.');
  if (!row.data) return false;
  const enrollment = row.data as FoundingEnrollment;
  const { subscription, actions } = await squareRequest<{ subscription: Subscription; actions?: AnchorAction[] }>(`/v2/subscriptions/${encodeURIComponent(subscriptionId)}?include=actions`);
  if (subscription.customer_id !== enrollment.square_customer_id || subscription.location_id !== config.locationId) throw new Error('Square subscription mismatch.');
  // charged_through_date alone includes unpaid invoices. Extend access only when
  // the newest provider invoice for this subscription is fully paid.
  let paidThrough = enrollment.paid_through;
  const latestInvoiceId = subscription.invoice_ids?.[0];
  if (latestInvoiceId) {
    const { invoice } = await squareRequest<{ invoice: { subscription_id?: string; location_id?: string; status?: string; primary_recipient?: { customer_id?: string }; payment_requests?: Array<{ computed_amount_money?: { amount?: number; currency?: string }; total_completed_amount_money?: { amount?: number; currency?: string } }> } }>(`/v2/invoices/${encodeURIComponent(latestInvoiceId)}`);
    if (invoice.subscription_id !== enrollment.square_subscription_id || invoice.location_id !== config.locationId || invoice.primary_recipient?.customer_id !== enrollment.square_customer_id) throw new Error('Square invoice mismatch.');
    if (invoice.status === 'PAID' && invoice.payment_requests?.length && invoice.payment_requests.every(request => request.computed_amount_money?.currency === 'USD' && request.total_completed_amount_money?.currency === 'USD' && (request.computed_amount_money.amount ?? 0) > 0 && request.computed_amount_money.amount === request.total_completed_amount_money.amount)) {
      paidThrough = subscription.charged_through_date ?? paidThrough;
      for (const action of actions ?? []) if (action.type === 'CHANGE_BILLING_ANCHOR_DATE' && action.effective_date && paidThrough && action.effective_date < paidThrough) paidThrough = action.effective_date;
    } else if (['REFUNDED', 'PARTIALLY_REFUNDED'].includes(invoice.status ?? '')) paidThrough = null;
  }
  await updateFounding(admin, enrollment.id, {
    paid_through: paidThrough,
    ...((['CANCELED', 'DEACTIVATED'].includes(subscription.status ?? '') || subscription.canceled_date) ? { status: 'canceled' } : {}),
  });
  return true;
}
