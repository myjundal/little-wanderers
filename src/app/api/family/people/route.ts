import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { getLatestHouseholdIdForUser } from '@/lib/households';
import { familyPersonSchema, FAMILY_PERSON_SELECT } from '@/lib/family-info';
import { logger } from '@/lib/logger';

const newPersonSchema = familyPersonSchema.extend({ role: z.enum(['adult', 'child']) });

export async function POST(request: Request) {
  const server = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await server.auth.getUser();
  if (authError || !user) return NextResponse.json({ ok: false, error: 'Please sign in again.' }, { status: 401 });

  const parsed = newPersonSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message || 'Please check your family member’s information.' }, { status: 400 });

  try {
    const admin = createAdminSupabaseClient();
    // Derive the destination from the verified login, never from browser input.
    const householdId = await getLatestHouseholdIdForUser(admin, user.id);
    if (!householdId) return NextResponse.json({ ok: false, error: 'Your family account could not be found. Please sign in again.' }, { status: 403 });

    const { data: person, error } = await admin.from('people')
      .insert({ ...parsed.data, household_id: householdId })
      .select(FAMILY_PERSON_SELECT).single();
    if (error || !person) {
      logger.error({ action: 'family.person_create_failed', userId: user.id, householdId, code: error?.code });
      return NextResponse.json({ ok: false, error: 'Unable to add your family member right now. Your entries are still here. Please try again.' }, { status: 500 });
    }
    return NextResponse.json({ ok: true, person });
  } catch {
    logger.error({ action: 'family.person_create_failed', userId: user.id });
    return NextResponse.json({ ok: false, error: 'Unable to add your family member right now. Your entries are still here. Please try again.' }, { status: 500 });
  }
}
