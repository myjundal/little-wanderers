import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { FAMILY_PRIMARY_CAREGIVER_ROLE } from '@/lib/family-roles';
import { normalizeWaitlistEmail } from '@/lib/waitlist';

type WaitlistUser = { id: string; email?: string | null };

async function attachPrebookedHousehold(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  user: WaitlistUser,
  normalizedEmail: string
) {
  const existingMember = await admin
    .from('household_members')
    .select('household_id')
    .eq('user_id', user.id)
    .limit(10);

  if (existingMember.error) throw new Error(existingMember.error.message);

  const prebooked = await admin
    .from('households')
    .select('id,email')
    .ilike('email', normalizedEmail)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (prebooked.error) throw new Error(prebooked.error.message);
  if (!prebooked.data?.id) return null;
  const prebookedHouseholdId = prebooked.data.id as string;

  const linkedMember = await admin
    .from('household_members')
    .select('user_id')
    .eq('household_id', prebookedHouseholdId)
    .not('user_id', 'is', null)
    .neq('user_id', user.id)
    .limit(1);

  if (linkedMember.error) throw new Error(linkedMember.error.message);
  if ((linkedMember.data ?? []).length > 0) return null;

  const hasParty = await admin
    .from('party_bookings')
    .select('id')
    .eq('household_id', prebookedHouseholdId)
    .neq('status', 'cancelled')
    .limit(1);

  if (hasParty.error) throw new Error(hasParty.error.message);
  if ((hasParty.data ?? []).length === 0) return null;

  const update = await admin
    .from('households')
    .update({
      email: user.email ?? normalizedEmail,
      role: FAMILY_PRIMARY_CAREGIVER_ROLE,
    })
    .eq('id', prebookedHouseholdId);

  if (update.error) throw new Error(update.error.message);

  const member = await admin
    .from('household_members')
    .upsert({
      household_id: prebookedHouseholdId,
      user_id: user.id,
      role: FAMILY_PRIMARY_CAREGIVER_ROLE,
    }, { onConflict: 'household_id,user_id' });

  if (member.error) throw new Error(member.error.message);

  const placeholderHouseholdIds = (existingMember.data ?? [])
    .map((item) => item.household_id as string)
    .filter((householdId) => householdId && householdId !== prebookedHouseholdId);

  if (placeholderHouseholdIds.length > 0) {
    const [{ data: households }, { data: people }, { data: parties }] = await Promise.all([
      admin.from('households').select('id,name').in('id', placeholderHouseholdIds),
      admin.from('people').select('household_id').in('household_id', placeholderHouseholdIds),
      admin.from('party_bookings').select('household_id').in('household_id', placeholderHouseholdIds).neq('status', 'cancelled'),
    ]);
    const nonEmptyHouseholdIds = new Set([
      ...(people ?? []).map((item) => item.household_id),
      ...(parties ?? []).map((item) => item.household_id),
    ]);
    const emptyAutoHouseholdIds = (households ?? [])
      .filter((household) => household.name === 'My Household' && !nonEmptyHouseholdIds.has(household.id))
      .map((household) => household.id);

    if (emptyAutoHouseholdIds.length > 0) {
      await admin.from('household_members').delete().eq('user_id', user.id).in('household_id', emptyAutoHouseholdIds);
      await admin.from('households').delete().in('id', emptyAutoHouseholdIds);
    }
  }

  return prebookedHouseholdId;
}

export async function claimWaitlistForUser(user: WaitlistUser) {
  const normalizedEmail = normalizeWaitlistEmail(user.email ?? '');
  if (!normalizedEmail) {
    return { claimed: false, householdId: null };
  }

  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from('waitlist_entries')
    .update({
      claimed_user_id: user.id,
      claimed_at: new Date().toISOString(),
    })
    .eq('normalized_email', normalizedEmail)
    .select('id')
    .maybeSingle();

  if (error) throw error;

  try {
    const householdId = await attachPrebookedHousehold(admin, user, normalizedEmail);
    return { claimed: Boolean(data), householdId };
  } catch {
    return { claimed: Boolean(data), householdId: null };
  }
}

export async function userNeedsOnboarding(userId: string) {
  const admin = createAdminSupabaseClient();
  const { data: memberships, error: memberError } = await admin
    .from('household_members')
    .select('household_id,created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1);

  if (memberError) throw memberError;

  const householdId = memberships?.[0]?.household_id as string | undefined;
  if (!householdId) return true;

  const { data: people, error: peopleError } = await admin
    .from('people')
    .select('id')
    .eq('household_id', householdId)
    .limit(1);

  if (peopleError) throw peopleError;

  const hasPeople = (people ?? []).length > 0;
  return !hasPeople;
}

export async function getPostAuthRedirectForUser(
  user: WaitlistUser,
  next: string,
  options: { forceOnboarding?: boolean } = {}
) {
  if (user.email) {
    await claimWaitlistForUser(user).catch(() => null);
  }

  if (options.forceOnboarding) return '/onboarding';

  const needsOnboarding = await userNeedsOnboarding(user.id).catch(() => false);
  return needsOnboarding ? '/onboarding' : next;
}
