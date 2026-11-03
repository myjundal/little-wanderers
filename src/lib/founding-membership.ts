import { parseBirthdate } from '@/lib/birthdate';

export const FOUNDING_TERMS_VERSION = '2026-11-03';
export const FOUNDING_BASE_CENTS = 5000;
export const FOUNDING_SIBLING_CENTS = 2000;
export const FOUNDING_TERMS = 'No payment today. I authorize Little Wanderers to securely save my card with Square and charge $50/month for the first child, plus $20/month for each sibling age 6 months or older, beginning on the announced soft opening date. Baby siblings under 6 months are free until the billing cycle following their six-month birthday. My membership renews monthly until I cancel. I can cancel anytime with no commitment. The $50 base rate continues while my membership stays active; cancellation ends that rate. A soft opening visit is included, subject to reservations, capacity, and a signed waiver. The opening date is not yet set.';

export function easternDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  return ['year', 'month', 'day'].map(type => parts.find(p => p.type === type)!.value).join('-');
}

export function isDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

/** Calendar months, clamped to the last day (not a fixed number of days). */
export function addMonths(value: string, months: number) {
  const [year, month, day] = value.split('-').map(Number);
  const end = new Date(Date.UTC(year, month - 1 + months + 1, 0));
  return new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), Math.min(day, end.getUTCDate()))).toISOString().slice(0, 10);
}

export function foundingMonthlyCents(birthdates: string[], on: string) {
  if (!birthdates.length || birthdates.some(value => !parseBirthdate(value) || value > on) || !isDate(on)) throw new Error('Add a valid birthday for every child.');
  // The oldest child is always the first child, including infant-only families.
  const sorted = [...birthdates].sort();
  return FOUNDING_BASE_CENTS + sorted.slice(1).filter(birthdate => addMonths(birthdate, 6) <= on).length * FOUNDING_SIBLING_CENTS;
}

/** Square static phases preserve the base rate and age babies into sibling pricing. */
export function foundingPhases(birthdates: string[], startDate: string) {
  const phases: Array<{ cadence: 'MONTHLY'; periods?: number; pricing: { type: 'STATIC'; price_money: { amount: number; currency: 'USD' } } }> = [];
  for (let cycle = 0; cycle <= 7; cycle++) {
    const amount = foundingMonthlyCents(birthdates, addMonths(startDate, cycle));
    const previous = phases.at(-1);
    if (previous?.pricing.price_money.amount === amount) previous.periods = (previous.periods ?? 0) + 1;
    else phases.push({ cadence: 'MONTHLY', periods: 1, pricing: { type: 'STATIC', price_money: { amount, currency: 'USD' } } });
  }
  delete phases.at(-1)!.periods;
  return phases;
}

export type FoundingStatus = 'draft' | 'saving_card' | 'pending' | 'activating' | 'scheduled' | 'active' | 'canceling' | 'canceled';
export type FoundingEnrollment = {
  id: string; household_id: string; status: FoundingStatus; environment: 'sandbox' | 'production';
  square_customer_id: string | null; square_card_id: string | null; square_subscription_id: string | null;
  card_brand: string | null; card_last4: string | null; child_ids: string[];
  birthdates: string[]; start_date: string | null; paid_through: string | null;
  amount_cents: number; terms_version: string; consent_at: string;
};
