export async function getLatestHouseholdIdForUser(supabase: any, userId: string) {
  const { data, error } = await supabase
    .from('household_members')
    .select('household_id,created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) {
    console.error('[households] getLatestHouseholdIdForUser error', error);
    throw new Error(`household_members lookup failed: ${error.message} (${error.code ?? 'no-code'})`);
  }

  return data?.[0]?.household_id ?? null;
}

export async function ensureHouseholdForUser(supabase: any, userId: string, fallbackName = 'My Household') {
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
    return existingHouseholdId;
  }

  const { data: household, error: householdError } = await supabase
    .from('households')
    .insert({ name: fallbackName })
    .select('id')
    .single();

  if (householdError) {
    throw householdError;
  }

  console.debug('[household-bootstrap] inserting household_member', {
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
    throw membershipError;
  }

  return household.id;
}
