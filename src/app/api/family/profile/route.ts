import { NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getPrimaryGuardianProfile } from '@/lib/family-profile';
import { getLatestHouseholdIdForUser } from '@/lib/households';

export const dynamic = 'force-dynamic';

export async function GET() {
  const server = createServerSupabaseClient();
  const {
    data: { user },
    error: userError,
  } = await server.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ ok: false, error: 'Please sign in again.' }, { status: 401 });
  }

  try {
    const admin = createAdminSupabaseClient();
    const householdId = await getLatestHouseholdIdForUser(admin, user.id);
    if (!householdId) {
      return NextResponse.json({ ok: true, guardian: null });
    }

    const [guardian, childrenResult] = await Promise.all([
      getPrimaryGuardianProfile(admin, householdId),
      admin
        .from('people')
        .select('id,first_name,last_name,birthdate')
        .eq('household_id', householdId)
        .eq('role', 'child')
        .order('created_at', { ascending: true }),
    ]);
    if (childrenResult.error) throw new Error(childrenResult.error.message);

    return NextResponse.json({
      ok: true,
      household_id: householdId,
      guardian: guardian ? { first_name: guardian.first_name, last_name: guardian.last_name } : null,
      children: childrenResult.data ?? [],
    });
  } catch {
    return NextResponse.json({ ok: false, error: 'Unable to load your family profile right now.' }, { status: 500 });
  }
}
