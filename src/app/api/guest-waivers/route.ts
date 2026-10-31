import { randomBytes, randomInt } from 'node:crypto';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { sendResendEmail } from '@/lib/email-campaigns';
import { isUuid } from '@/lib/open-play-reservations';
import { GUEST_WAIVER_COOKIE, guestEmailSchema, guestProfileSchema, guestTokenHash, guestSecretHash, guestFamilyRevision, type GuestWaiverContext } from '@/lib/guest-waivers';
import { WAIVER_VERSION, WAIVER_TITLE, WAIVER_PARAGRAPHS, WAIVER_AGREEMENTS, WAIVER_SIGNATURE_TEXT } from '@/lib/waiver-content';

export const dynamic = 'force-dynamic';
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
const sessionToken = async () => (await cookies()).get(GUEST_WAIVER_COOKIE)?.value ?? '';

export async function GET() {
  try {
    const token = await sessionToken();
    if (!/^[a-f0-9]{64}$/.test(token)) return json({ ok: true, verified: false });
    const { data, error } = await createAdminSupabaseClient().rpc('guest_waiver_context', { p_token_hash: guestTokenHash(token), p_version: WAIVER_VERSION });
    if (error) return json({ ok: false, error: 'Please ask the front desk to help connect your family records.' }, 409);
    const context = data as GuestWaiverContext;
    return json({ ok: true, ...context, version: WAIVER_VERSION, family_revision: guestFamilyRevision(context.children ?? []) });
  } catch { return json({ ok: false, error: 'Unable to load your waiver. Please try again.' }, 503); }
}

export async function POST(req: Request) {
  const origin = req.headers.get('origin');
  if ((origin && origin !== new URL(req.url).origin) || req.headers.get('sec-fetch-site') === 'cross-site') return json({ ok: false, error: 'Open this form on the Little Wanderers website.' }, 403);
  try {
    const text = await req.text();
    if (text.length > 30_000) return json({ ok: false, error: 'This form is too large.' }, 413);
    let body;
    try { body = JSON.parse(text); } catch { return json({ ok: false, error: 'Invalid request.' }, 400); }
    if (!body || typeof body !== 'object') return json({ ok: false, error: 'Invalid request.' }, 400);
    if (body.mode === 'end_session') {
      const token = await sessionToken();
      if (/^[a-f0-9]{64}$/.test(token)) {
        const { error } = await createAdminSupabaseClient().from('guest_waiver_sessions').update({ expires_at: new Date().toISOString() }).eq('token_hash', guestTokenHash(token));
        if (error) throw error;
      }
      const response = json({ ok: true });
      response.cookies.set(GUEST_WAIVER_COOKIE, '', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 0 });
      return response;
    }
    const admin = createAdminSupabaseClient();
    if (body.mode === 'request_code') {
      const email = guestEmailSchema.safeParse(body.email);
      if (!email.success || (body.party_id && !isUuid(body.party_id))) return json({ ok: false, error: 'Enter a valid email address and party link.' }, 400);
      const token = randomBytes(32).toString('hex');
      const code = String(randomInt(100000, 1000000));
      const ip = req.headers.get('x-vercel-forwarded-for') || req.headers.get('x-forwarded-for') || 'unknown';
      const { data, error } = await admin.rpc('begin_guest_waiver', { p_email: email.data, p_token_hash: guestTokenHash(token),
        p_code_hash: guestSecretHash(`${token}:${code}`), p_ip_hash: guestSecretHash(ip.split(',')[0].trim()), p_party: body.party_id || null });
      if (error) throw error;
      if (!data?.ok) return json({ ok: false, error: data?.code === 'party_unavailable' ? 'This party link is no longer available. Please ask the front desk.' : 'Please wait before requesting another code.' }, data?.code === 'party_unavailable' ? 409 : 429);
      const sent = await sendResendEmail({ to: email.data, subject: 'Your Little Wanderers waiver code',
        html: `<p>Your waiver verification code is <strong>${code}</strong>.</p><p>It expires in 15 minutes. Enter it on the Little Wanderers waiver page to continue.</p><p>This verifies your email for your family waiver. It does not create an account or subscribe you to marketing.</p>` });
      if (!sent.ok) throw new Error('Email delivery failed');
      const response = json({ ok: true, code_sent: true });
      response.cookies.set(GUEST_WAIVER_COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 7200 });
      return response;
    }
    const token = await sessionToken();
    if (!/^[a-f0-9]{64}$/.test(token)) return json({ ok: false, error: 'Please verify your email first.' }, 401);
    const hash = guestTokenHash(token);
    if (body.mode === 'verify_code') {
      if (typeof body.code !== 'string' || !/^\d{6}$/.test(body.code)) return json({ ok: false, error: 'Enter the six-digit email code.' }, 400);
      const { data, error } = await admin.rpc('verify_guest_waiver', { p_token_hash: hash, p_code_hash: guestSecretHash(`${token}:${body.code}`) });
      if (error) throw error;
      return data?.ok ? json({ ok: true, verified: true }) : json({ ok: false, error: data?.code === 'incorrect_code' ? 'That code does not match. Please try again.' : 'Your code expired or has too many attempts. Request a new code.' }, 401);
    }
    if (!['sign','use_saved'].includes(body.mode)) return json({ ok: false, error: 'Invalid request.' }, 400);
    const { data: raw, error: contextError } = await admin.rpc('guest_waiver_context', { p_token_hash: hash, p_version: WAIVER_VERSION });
    if (contextError) return json({ ok: false, error: 'Please ask the front desk to help connect your family records.' }, 409);
    const context = raw as GuestWaiverContext;
    if (!context?.verified) return json({ ok: false, error: 'Please verify your email again.' }, 401);
    if (body.mode === 'use_saved') {
      if (!context.existing_waiver) return json({ ok: false, error: 'Please review and sign a current waiver.' }, 409);
      const { data, error } = await admin.rpc('use_guest_waiver', { p_token_hash: hash, p_waiver: context.existing_waiver.id, p_version: WAIVER_VERSION });
      return error ? json({ ok: false, error: 'Your saved waiver changed. Reload and review it before continuing.' }, 409) : json({ ok: true, completed: true, ...data });
    }
    if (body.version !== WAIVER_VERSION) return json({ ok: false, error: 'The waiver changed. Reload before signing.' }, 409);
    const parsed = guestProfileSchema.safeParse(body);
    if (!parsed.success || !WAIVER_AGREEMENTS.every(item => parsed.data?.agreements[item.id] === true)) return json({ ok: false, error: 'Complete the guardian details, child names and birthdays, all required agreements, photo preference and signature.' }, 400);
    if (!context.waiver_id && body.family_revision !== guestFamilyRevision(context.children ?? [])) return json({ ok: false, error: 'Your family changed. Reload and review the children before signing.' }, 409);
    if (!(context.children?.length || parsed.data.children.length)) return json({ ok: false, error: 'Add at least one child.' }, 400);
    const { data, error } = await admin.rpc('sign_guest_waiver', { p_token_hash: hash, p_expected_children: context.children ?? [], p_profile: parsed.data,
      p_version: WAIVER_VERSION, p_snapshot: { title: WAIVER_TITLE, paragraphs: WAIVER_PARAGRAPHS, agreements: WAIVER_AGREEMENTS,
        signature_text: WAIVER_SIGNATURE_TEXT, is_guardian: true, electronic_consent: true } });
    if (error) return json({ ok: false, error: 'Your family details changed or need review. Reload the form; if this continues, ask the front desk. Your waiver is not confirmed.' }, 409);
    return json({ ok: true, completed: true, ...data });
  } catch { return json({ ok: false, error: 'Your request could not be saved or sent. Please try again; do not assume the waiver is complete.' }, 503); }
}
