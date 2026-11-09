import { NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getPrimaryGuardianProfile } from '@/lib/family-profile';
import { getLatestHouseholdIdForUser } from '@/lib/households';
import { isFamilyManagerRole } from '@/lib/family-roles';
import { familyContactSchema } from '@/lib/family-info';

export const dynamic = 'force-dynamic';

export async function GET() {
  const server = await createServerSupabaseClient();
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

export async function PATCH(request: Request) {
  const server = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await server.auth.getUser();
  if (authError || !user) return NextResponse.json({ ok: false, error: 'Please sign in again.' }, { status: 401 });

  const parsed = familyContactSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message || 'Please check your family information.' }, { status: 400 });

  try {
    const admin = createAdminSupabaseClient();
    const householdId = await getLatestHouseholdIdForUser(admin, user.id);
    if (!householdId) return NextResponse.json({ ok: false, error: 'Your family account could not be found.' }, { status: 403 });
    const { data: membership, error: memberError } = await admin.from('household_members')
      .select('role').eq('household_id', householdId).eq('user_id', user.id).maybeSingle();
    if (memberError) throw memberError;
    if (!isFamilyManagerRole(membership?.role)) return NextResponse.json({ ok: false, error: 'Only a family caregiver can update the family contact information.' }, { status: 403 });

    const { data: household, error } = await admin.from('households').update(parsed.data)
      .eq('id', householdId).select('phone,city,state').maybeSingle();
    if (error) throw error;
    if (!household) return NextResponse.json({ ok: false, error: 'Your family account could not be found.' }, { status: 404 });
    return NextResponse.json({ ok: true, household });
  } catch {
    return NextResponse.json({ ok: false, error: 'Unable to save your family information right now. Your changes have not been saved.' }, { status: 500 });
  }
}
