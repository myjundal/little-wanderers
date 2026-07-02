import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { claimWaitlistForUser } from '@/lib/waitlist-claim';

export const dynamic = 'force-dynamic';

export async function POST() {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user?.email) {
    return NextResponse.json({ ok: false, error: 'Please sign in again.' }, { status: 401 });
  }

  try {
    const result = await claimWaitlistForUser(user);
    return NextResponse.json({ ok: true, claimed: result.claimed, household_id: result.householdId });
  } catch {
    return NextResponse.json({ ok: false, error: 'Unable to mark waitlist access as claimed.' }, { status: 500 });
  }
}
