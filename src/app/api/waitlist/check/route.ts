import { NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { isLikelyEmail, normalizeWaitlistEmail, WAITLIST_JOIN_URL } from '@/lib/waitlist';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { email?: string } | null;
  const email = String(body?.email ?? '').trim();

  if (!isLikelyEmail(email)) {
    return NextResponse.json({ ok: false, allowed: false, error: 'Please enter a valid email address.' }, { status: 400 });
  }

  const normalizedEmail = normalizeWaitlistEmail(email);
  if (!normalizedEmail) {
    return NextResponse.json({ ok: false, allowed: false, error: 'Please enter a valid email address.' }, { status: 400 });
  }

  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from('waitlist_entries')
    .select('id,claimed_user_id,claimed_at')
    .eq('normalized_email', normalizedEmail)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ ok: false, allowed: false, error: 'Unable to check waitlist access right now.' }, { status: 500 });
  }

  const claimed = Boolean(data?.claimed_user_id);
  if (data?.claimed_at && !data.claimed_user_id) {
    await admin
      .from('waitlist_entries')
      .update({ claimed_at: null })
      .eq('id', data.id)
      .is('claimed_user_id', null);
  }

  return NextResponse.json({
    ok: true,
    allowed: Boolean(data),
    claimed,
    waitlist_url: WAITLIST_JOIN_URL,
  });
}
