import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { getLatestHouseholdIdForUser } from '@/lib/households';
import { familyPersonSchema, FAMILY_PERSON_SELECT } from '@/lib/family-info';

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const server = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await server.auth.getUser();
  if (authError || !user) return NextResponse.json({ ok: false, error: 'Please sign in again.' }, { status: 401 });

  const parsed = familyPersonSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message || 'Please check your family member’s information.' }, { status: 400 });

  try {
    const admin = createAdminSupabaseClient();
    const householdId = await getLatestHouseholdIdForUser(admin, user.id);
    if (!householdId) return NextResponse.json({ ok: false, error: 'Your family account could not be found.' }, { status: 403 });

    const { id } = await context.params;
    const { data: person, error } = await admin.from('people')
      .update(parsed.data).eq('id', id).eq('household_id', householdId)
      .select(FAMILY_PERSON_SELECT).maybeSingle();

    if (error) throw error;
    if (!person) return NextResponse.json({ ok: false, error: 'This family member could not be found. Refresh the page and try again.' }, { status: 404 });
    return NextResponse.json({ ok: true, person });
  } catch {
    return NextResponse.json({ ok: false, error: 'Unable to save your family member right now. Your changes have not been saved.' }, { status: 500 });
  }
}
