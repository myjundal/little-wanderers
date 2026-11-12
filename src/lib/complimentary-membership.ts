import type { SupabaseClient } from '@supabase/supabase-js';
import { squareEnvironment } from '@/lib/square-client';

type Membership = { id: string; household_id?: string | null; person_id?: string | null; renews_at?: string | null; square_environment?: string | null; square_subscription_id?: string | null; square_customer_id?: string | null; payment_review_required?: boolean; covered_person_ids?: string[] };

// A complimentary entitlement has no payment provider or renewal attached.
// Do not treat a saved card, an unverified legacy row, or a paid subscription as a gift.
export function isComplimentaryMembership(row: Membership, environment: string) {
  return row.square_environment === environment && row.renews_at === null
    && !row.square_subscription_id && !row.square_customer_id && row.payment_review_required === false
    && !row.person_id && Boolean(row.household_id) && Boolean(row.covered_person_ids?.length);
}

export async function readComplimentaryMembership(admin: SupabaseClient, householdId: string) {
  const result = await admin.from('memberships').select('*').eq('household_id', householdId);
  if (result.error) throw new Error('Unable to confirm complimentary membership. Please refresh.');
  return (result.data as Membership[] | null)?.find(row => isComplimentaryMembership(row, squareEnvironment())) ?? null;
}

export const COMPLIMENTARY_MEMBERSHIP_MESSAGE = 'Your family has a lifetime Friends & Family membership. Open Play is complimentary, with no monthly fees or automatic billing.';
