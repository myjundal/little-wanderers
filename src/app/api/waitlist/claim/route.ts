import { NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { normalizeWaitlistEmail } from '@/lib/waitlist';

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

  const normalizedEmail = normalizeWaitlistEmail(user.email);
  if (!normalizedEmail) {
    return NextResponse.json({ ok: false, error: 'No waitlist email found for this account.' }, { status: 400 });
  }

  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from('waitlist_entries')
    .update({
      claimed_user_id: user.id,
      claimed_at: new Date().toISOString(),
    })
    .eq('normalized_email', normalizedEmail)
    .select('id')
    .maybeSingle();

  if (error) {
    return NextResponse.json({ ok: false, error: 'Unable to mark waitlist access as claimed.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, claimed: Boolean(data) });
}
