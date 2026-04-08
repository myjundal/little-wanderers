export async function getLatestHouseholdIdForUser(supabase: any, userId: string) {
  const { data, error } = await supabase
    .from('household_members')
    .select('household_id,created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) {
    throw error;
  }

  return data?.[0]?.household_id ?? null;
}

export async function ensureHouseholdForUser(supabase: any, userId: string, fallbackName = 'My Household') {
  const existingHouseholdId = await getLatestHouseholdIdForUser(supabase, userId);
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

  const { error: membershipError } = await supabase
    .from('household_members')
    .upsert(
      {
        household_id: household.id,
        user_id: userId,
        role: 'owner',
      },
      { onConflict: 'household_id,user_id' }
    );

  if (membershipError) {
    throw membershipError;
  }

  return household.id;
}
