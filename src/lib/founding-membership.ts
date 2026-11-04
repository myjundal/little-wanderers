import { parseBirthdate } from '@/lib/birthdate';

export const FOUNDING_TERMS_VERSION = '2026-11-03-first-visit';
export type MembershipTier = 'waitlist' | 'public' | 'regular';
export type MembershipPhase = MembershipTier;
export const MEMBERSHIP_PRICES = {
  waitlist: { base_cents: 5000, sibling_cents: 1000, label: 'Wanderlist founding', two_child_discount: 25 },
  public: { base_cents: 5000, sibling_cents: 2000, label: 'Public founding', two_child_discount: 12.5 },
  regular: { base_cents: 6000, sibling_cents: 2000, label: 'Regular membership', two_child_discount: 0 },
} as const;
export type MembershipOffer = { phase: MembershipPhase; tier: MembershipTier; can_enroll: boolean; card_enrollment_enabled?: boolean; base_cents: number; sibling_cents: number };
export function membershipTerms(tier: MembershipTier) {
  const price = MEMBERSHIP_PRICES[tier];
  return `No payment today. I authorize Little Wanderers to securely save my card with Square and charge $${price.base_cents / 100}/month for the first child, plus $${price.sibling_cents / 100}/month for each sibling age 6 months or older, beginning on the day of my first membership visit, including a visit during soft opening. Little Wanderers will activate my membership when I arrive; saving my card does not start billing. Baby siblings under 6 months are free until the billing cycle following their six-month birthday. My membership renews monthly until I cancel. I can cancel anytime with no commitment. ${tier === 'regular' ? 'Regular membership pricing applies.' : 'My founding first-child and sibling rates are locked in for the lifetime of my continuously active membership.'} Cancellation ends founding pricing permanently. If I rejoin, regular pricing applies: $60/month for the first child and $20/month for each eligible sibling. Visits throughout the soft opening period are included with my membership, with no separate admission charge, subject to reservations, capacity, and a signed waiver. My billing start date is not set until my first membership visit.`;
}
export const FOUNDING_TERMS = membershipTerms('public');

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

export function foundingMonthlyCents(birthdates: string[], on: string, tier: MembershipTier = 'public') {
  if (!birthdates.length || birthdates.some(value => !parseBirthdate(value) || value > on) || !isDate(on)) throw new Error('Add a valid birthday for every child.');
  // The oldest child is always the first child, including infant-only families.
  const sorted = [...birthdates].sort();
  const price = MEMBERSHIP_PRICES[tier];
  return price.base_cents + sorted.slice(1).filter(birthdate => addMonths(birthdate, 6) <= on).length * price.sibling_cents;
}

/** Square static phases preserve the base rate and age babies into sibling pricing. */
export function foundingPhases(birthdates: string[], startDate: string, tier: MembershipTier = 'public') {
  const phases: Array<{ cadence: 'MONTHLY'; periods?: number; pricing: { type: 'STATIC'; price_money: { amount: number; currency: 'USD' } } }> = [];
  for (let cycle = 0; cycle <= 7; cycle++) {
    const amount = foundingMonthlyCents(birthdates, addMonths(startDate, cycle), tier);
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
  pricing_tier: MembershipTier; base_cents: number; sibling_cents: number;
};
