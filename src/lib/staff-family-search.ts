import type { SupabaseClient } from '@supabase/supabase-js';

/** Only explicit, confirmed duplicates share a staff search result. Names alone never merge families. */
export async function getStaffFamilySearchAliases(admin: SupabaseClient) {
  const { data, error } = await admin.from('staff_family_search_aliases')
    .select('alias_household_id,canonical_household_id').limit(1001);
  if (error || (data?.length ?? 0) > 1000) throw new Error('Unable to load family directory links.');
  const aliases = new Map<string, string>((data ?? []).map(row => [row.alias_household_id, row.canonical_household_id]));
  // Keep configuration unambiguous; an alias must point straight to its family.
  for (const target of aliases.values()) if (aliases.has(target)) throw new Error('Family directory links require review.');
  return aliases;
}
