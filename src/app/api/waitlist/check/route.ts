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
    return NextResponse.json({ ok: false, allowed: false, error: 'Unable to check Wanderlist access right now.' }, { status: 500 });
  }

  let waitlistEntry = data;

  if (!waitlistEntry) {
    const { data: inserted, error: insertError } = await admin
      .from('waitlist_entries')
      .insert({
        email,
        normalized_email: normalizedEmail,
        source: 'website_signup',
        raw_payload: {
          created_from: 'login',
          created_at: new Date().toISOString(),
        },
        synced_at: new Date().toISOString(),
      })
      .select('id,claimed_user_id,claimed_at')
      .maybeSingle();

    if (insertError) {
      const retry = await admin
        .from('waitlist_entries')
        .select('id,claimed_user_id,claimed_at')
        .eq('normalized_email', normalizedEmail)
        .maybeSingle();

      if (retry.error || !retry.data) {
        return NextResponse.json({ ok: false, allowed: false, error: 'Unable to create Wanderlist access right now.' }, { status: 500 });
      }

      waitlistEntry = retry.data;
    } else {
      waitlistEntry = inserted;
    }
  }

  const claimed = Boolean(waitlistEntry?.claimed_user_id);
  if (waitlistEntry?.claimed_at && !waitlistEntry.claimed_user_id) {
    await admin
      .from('waitlist_entries')
      .update({ claimed_at: null })
      .eq('id', waitlistEntry.id)
      .is('claimed_user_id', null);
  }

  return NextResponse.json({
    ok: true,
    allowed: Boolean(waitlistEntry),
    claimed,
    waitlist_url: WAITLIST_JOIN_URL,
  });
}
