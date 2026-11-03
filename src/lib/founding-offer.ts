import type { SupabaseClient } from '@supabase/supabase-js';
import type { MembershipOffer } from '@/lib/founding-membership';
import { squareEnvironment } from '@/lib/square-client';

export async function getMembershipOffer(admin: SupabaseClient, userId: string | null = null, householdId: string | null = null): Promise<MembershipOffer> {
  const result = await admin.rpc('founding_membership_offer', { p_user: userId, p_household: householdId, p_environment: squareEnvironment() });
  if (result.error || !result.data) throw new Error('Unable to confirm your membership offer.');
  return result.data as MembershipOffer;
}
