import type { SupabaseClient } from '@supabase/supabase-js';
import { addMonths, easternDate, foundingMonthlyCents, FOUNDING_TERMS_VERSION, type FoundingEnrollment } from '@/lib/founding-membership';
import { squareEnvironment, squareRequest, squareConfig } from '@/lib/square-client';
import { createHash } from 'node:crypto';

/** app_metadata is written only by the auth administrator, never by a customer. */
export function ownerFoundingBillingEnabled(user?: { app_metadata?: Record<string, unknown> } | null) {
  if (squareEnvironment() === 'production' && process.env.VERCEL_ENV === 'preview') return false;
  const grant = user?.app_metadata?.founding_billing_activation;
  return process.env.FOUNDING_BILLING_ENABLED === 'true' || Boolean(grant && typeof grant === 'object' && (grant as Record<string, unknown>)[squareEnvironment()] === true);
}

export async function foundingFirstVisit(admin: SupabaseClient, enrollment: FoundingEnrollment, now = new Date()) {
  if (!enrollment.child_ids?.length || !enrollment.consent_at) return null;
  const consentDate = easternDate(new Date(enrollment.consent_at));
  const [visits, aliases] = await Promise.all([
    admin.from('checkins').select('person_id,household_id,checked_in_at,source,square_environment').in('person_id', enrollment.child_ids).gte('checked_in_at', `${consentDate}T00:00:00Z`).lte('checked_in_at', now.toISOString()).order('checked_in_at').limit(1000),
    admin.from('staff_family_search_aliases').select('alias_household_id,canonical_household_id'),
  ]);
  if (visits.error || aliases.error || (visits.data?.length ?? 0) >= 1000) throw Error('Unable to verify the first membership visit.');
  const roots = new Map<string, string>((aliases.data ?? []).map(a => [a.alias_household_id, a.canonical_household_id]));
  const root = (id: string) => { const seen = new Set<string>(); while (roots.has(id) && !seen.has(id)) { seen.add(id); id = roots.get(id)!; } return id; };
  const visit = (visits.data ?? []).find(v => enrollment.child_ids.includes(v.person_id) && (!v.household_id || root(v.household_id) === root(enrollment.household_id)) && ['staff_manual', 'manual', 'qr', 'staff'].includes(v.source) && (v.square_environment == null || v.square_environment === enrollment.environment) && easternDate(new Date(v.checked_in_at)) >= consentDate);
  return visit ? easternDate(new Date(visit.checked_in_at)) : null;
}

export async function foundingBillingDetails(admin: SupabaseClient, enrollment: FoundingEnrollment, now = new Date()) {
  const firstVisit = await foundingFirstVisit(admin, enrollment, now);
  const start = enrollment.status === 'activating' ? enrollment.start_date : firstVisit;
  let error: string | null = null;
  if (!['pending', 'activating'].includes(enrollment.status)) error = 'This membership is already started or is not available for activation.';
  else if (!enrollment.square_card_id || !enrollment.square_customer_id || enrollment.terms_version !== FOUNDING_TERMS_VERSION) error = 'Current billing authorization and a saved card are required.';
  else if (!start || !firstVisit) error = 'Check in an enrolled child before starting billing.';
  else if (start !== firstVisit) error = 'The saved start date does not match the first membership visit. Review this membership before retrying.';
  else if (start > easternDate(now)) error = 'The first membership visit must have occurred already.';
  else if (enrollment.status !== 'activating' && addMonths(start, 1) <= easternDate(now)) error = 'The first billing period has already ended. Review this membership before starting billing.';
  const amount = start ? foundingMonthlyCents(enrollment.birthdates, start, enrollment.pricing_tier) : null;
  return { first_visit_date: firstVisit, start_date: start, amount_cents: amount, next_billing_date: start ? addMonths(start, 1) : null, error };
}

/** Persist the exact provider start before any write to Square. First visit remains the local anchor. */
export async function freezeFoundingSquareStart(admin: SupabaseClient, enrollment: FoundingEnrollment, ownerId: string, proposedDate: string) {
  const digest = createHash('sha256').update(`founding-billing-activation-v1:${enrollment.id}`).digest('hex');
  const id = `${digest.slice(0,8)}-${digest.slice(8,12)}-5${digest.slice(13,16)}-8${digest.slice(17,20)}-${digest.slice(20,32)}`;
  const notes = JSON.stringify({ version: 1, enrollment_id: enrollment.id, environment: enrollment.environment, first_visit_date: enrollment.start_date, square_start_date: proposedDate });
  const saved = await admin.from('membership_events').insert({ id, household_id: enrollment.household_id, action: 'billing_activation_parameters', notes, created_by_user_id: ownerId, created_by_role: 'owner' });
  if (saved.error && saved.error.code !== '23505') throw Error('Unable to freeze billing parameters. No Square subscription was requested.');
  const record = await admin.from('membership_events').select('notes').eq('id', id).single();
  if (record.error) throw Error('Unable to verify frozen billing parameters.');
  const value = JSON.parse(record.data.notes);
  if (value.version !== 1 || value.enrollment_id !== enrollment.id || value.environment !== enrollment.environment || value.first_visit_date !== enrollment.start_date || !/^\d{4}-\d{2}-\d{2}$/.test(value.square_start_date)) throw Error('Frozen billing parameters need review.');
  return value.square_start_date as string;
}

/** Read-only provider checks. Search is a POST endpoint but creates nothing. */
export async function verifyFoundingBillingCard(enrollment: FoundingEnrollment) {
  const { locationId, environment } = squareConfig();
  if (enrollment.environment !== environment || !enrollment.square_card_id || !enrollment.square_customer_id) throw Error('A saved card in the current Square environment is required.');
  const { card } = await squareRequest<{ card: { id: string; customer_id?: string; enabled?: boolean; last_4?: string; card_brand?: string } }>(`/v2/cards/${encodeURIComponent(enrollment.square_card_id)}`);
  if (!card || card.id !== enrollment.square_card_id || card.customer_id !== enrollment.square_customer_id || card.enabled !== true) throw Error('The saved card is unavailable. Ask the family to update its card before starting billing.');
  if (enrollment.status === 'pending') {
    let cursor: string | undefined;
    let pages = 0;
    do {
      const result = await squareRequest<{ subscriptions?: Array<{ id: string; status?: string; customer_id?: string; location_id?: string }>; cursor?: string }>('/v2/subscriptions/search', 'POST', { query: { filter: { customer_ids: [enrollment.square_customer_id], location_ids: [locationId] } }, limit: 100, ...(cursor ? { cursor } : {}) });
      if ((result.subscriptions ?? []).some(s => s.customer_id !== enrollment.square_customer_id || s.location_id !== locationId || !['CANCELED', 'DEACTIVATED'].includes(s.status ?? ''))) throw Error('An existing Square subscription needs review. No additional subscription has been created.');
      cursor = result.cursor;
      if (++pages >= 10 && cursor) throw Error('Unable to complete the existing subscription check.');
    } while (cursor);
  }
  return { card_last4: card.last_4 ?? enrollment.card_last4, card_brand: card.card_brand ?? enrollment.card_brand, existing_subscription_checked: enrollment.status === 'pending' };
}
