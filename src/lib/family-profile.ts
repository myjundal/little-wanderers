import type { SupabaseClient } from '@supabase/supabase-js';
import { FAMILY_PRIMARY_CAREGIVER_ROLE } from '@/lib/family-roles';

export type GuardianNameInput = {
  guardian_first_name?: unknown;
  guardian_last_name?: unknown;
};

function cleanName(value: unknown) {
  if (typeof value !== 'string') return null;
  const cleaned = value.trim().replace(/\s+/g, ' ');
  return cleaned ? cleaned.slice(0, 80) : null;
}

export function parseGuardianName(input: GuardianNameInput | null | undefined) {
  return {
    firstName: cleanName(input?.guardian_first_name),
    lastName: cleanName(input?.guardian_last_name),
  };
}

export function formatGuardianName(input: { firstName?: string | null; lastName?: string | null }) {
  return [input.firstName, input.lastName].filter(Boolean).join(' ').trim() || null;
}

export async function getPrimaryGuardianProfile(admin: SupabaseClient, householdId: string) {
  const { data, error } = await admin
    .from('people')
    .select('id,first_name,last_name')
    .eq('household_id', householdId)
    .eq('role', 'adult')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data as { id: string; first_name: string | null; last_name: string | null } | null;
}

export async function ensureGuardianProfile(input: {
  admin: SupabaseClient;
  householdId: string;
  userId: string;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}) {
  const firstName = cleanName(input.firstName);
  const lastName = cleanName(input.lastName);
  if (!firstName && !lastName && !input.email) return null;

  const fullName = formatGuardianName({ firstName, lastName });
  const householdPatch: Record<string, string | null> = {
    role: FAMILY_PRIMARY_CAREGIVER_ROLE,
  };
  if (input.email) householdPatch.email = input.email;
  if (fullName) householdPatch.name = `${fullName} Family`;

  await input.admin.from('households').update(householdPatch).eq('id', input.householdId);

  if (!firstName && !lastName) return null;

  const existing = await getPrimaryGuardianProfile(input.admin, input.householdId);
  if (existing?.id) {
    const { data, error } = await input.admin
      .from('people')
      .update({
        first_name: firstName ?? existing.first_name,
        last_name: lastName ?? existing.last_name,
      })
      .eq('id', existing.id)
      .select('id,first_name,last_name')
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data as { id: string; first_name: string | null; last_name: string | null } | null;
  }

  const { data, error } = await input.admin
    .from('people')
    .insert({
      household_id: input.householdId,
      role: 'adult',
      first_name: firstName ?? 'Guardian',
      last_name: lastName,
      gender: null,
      birthdate: null,
    })
    .select('id,first_name,last_name')
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data as { id: string; first_name: string | null; last_name: string | null } | null;
}
