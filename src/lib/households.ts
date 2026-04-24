import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';

type HouseholdMemberRow = { household_id: string; created_at: string };

type HouseholdClient = SupabaseClient;

function isMissingColumnError(message: string) {
  return /column .* does not exist|Could not find the '.*' column/i.test(message);
}

export async function getLatestHouseholdIdForUser(supabase: HouseholdClient, userId: string) {
  // Prefer a direct household owned by this auth user (customer context),
  // so operator-created manual households do not hijack landing/dashboard context.
  const { data: directHouseholdRows, error: directHouseholdError } = await supabase
    .from('households')
    .select('id,created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1);

  if (directHouseholdError) {
    if (!isMissingColumnError(directHouseholdError.message)) {
      logger.error({ action: 'household.direct_lookup_failed', userId }, directHouseholdError);
      throw new Error(`households direct lookup failed: ${directHouseholdError.message} (${directHouseholdError.code ?? 'no-code'})`);
    }
    logger.warn({ action: 'household.direct_lookup_missing_column_fallback', userId, message: directHouseholdError.message });
  }

  const directHouseholdId = (directHouseholdRows ?? [])[0]?.id ?? null;
  if (directHouseholdId) {
    logger.debug({ action: 'household.direct_lookup_succeeded', userId, householdId: directHouseholdId });
    return directHouseholdId;
  }

  const { data, error } = await supabase
    .from('household_members')
    .select('household_id,created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) {
    logger.error({ action: 'household.lookup_failed', userId }, error);
    throw new Error(`household_members lookup failed: ${error.message} (${error.code ?? 'no-code'})`);
  }

  const typedData = (data ?? []) as HouseholdMemberRow[];
  const householdId = typedData[0]?.household_id ?? null;
  logger.debug({ action: 'household.lookup_succeeded', userId, householdId });
  return householdId;
}

export async function ensureHouseholdForUser(supabase: HouseholdClient, userId: string, fallbackName = 'My Household') {
  const authResponse = typeof supabase?.auth?.getUser === 'function'
    ? await supabase.auth.getUser()
    : null;

  const authenticatedUserId = authResponse?.data?.user?.id ?? null;
  if (!authenticatedUserId) {
    throw new Error('No authenticated user found. Skipping household bootstrap.');
  }

  if (authenticatedUserId !== userId) {
    throw new Error('Authenticated user id mismatch. Refusing household bootstrap.');
  }

  const existingHouseholdId = await getLatestHouseholdIdForUser(supabase, authenticatedUserId);
  if (existingHouseholdId) {
    logger.info({ action: 'household.bootstrap_skipped_existing', userId: authenticatedUserId, householdId: existingHouseholdId });
    return existingHouseholdId;
  }

  const { data: household, error: householdError } = await supabase
    .from('households')
    .insert({ name: fallbackName })
    .select('id')
    .single();

  if (householdError) {
    logger.error({ action: 'household.create_failed', userId: authenticatedUserId }, householdError);
    throw householdError;
  }

  logger.info({
    action: 'household.bootstrap_member_upsert_start',
    householdId: household.id,
    userId: authenticatedUserId,
  });

  const { error: membershipError } = await supabase
    .from('household_members')
    .upsert(
      {
        household_id: household.id,
        user_id: authenticatedUserId,
        role: 'owner',
      },
      { onConflict: 'household_id,user_id' }
    );

  if (membershipError) {
    logger.error({ action: 'household.bootstrap_member_upsert_failed', householdId: household.id, userId: authenticatedUserId }, membershipError);
    throw membershipError;
  }

  logger.info({ action: 'household.bootstrap_completed', householdId: household.id, userId: authenticatedUserId });
  return household.id;
}
