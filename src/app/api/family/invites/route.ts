import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getLatestHouseholdIdForUser } from '@/lib/households';

function normalizeRole(input: unknown): 'admin' | 'member' {
  return input === 'admin' ? 'admin' : 'member';
}

async function sendInviteEmail(input: { email: string; role: 'admin' | 'member'; inviteToken: string }) {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return { ok: false, reason: 'RESEND_API_KEY is not configured' };

  const from = process.env.RESEND_FROM_EMAIL ?? 'Little Wanderers <onboarding@resend.dev>';
  const appBase = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
  const inviteUrl = `${appBase}/invite?token=${encodeURIComponent(input.inviteToken)}`;

  const html = `
    <h2>You’re invited to join a Little Wanderers family account</h2>
    <p>Your family invited you as a <b>${input.role === 'admin' ? 'co-admin caregiver' : 'caregiver'}</b>.</p>
    <p><a href="${inviteUrl}">Accept Invite</a></p>
    <p>If you already have an account, sign in and open the link again to accept.</p>
  `;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [input.email],
      subject: 'You’re invited to Little Wanderers',
      html,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    return { ok: false, reason: text || 'Failed to send invite email' };
  }

  return { ok: true as const };
}

export async function GET() {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ ok: false, error: 'Please sign in again.' }, { status: 401 });
  }

  const householdId = await getLatestHouseholdIdForUser(supabase, user.id);
  if (!householdId) {
    return NextResponse.json({ ok: true, items: [] });
  }

  const { data, error } = await supabase
    .from('household_invites')
    .select('id,email,role,status,expires_at,created_at')
    .eq('household_id', householdId)
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ ok: false, error: "You don’t have access to this information." }, { status: 403 });
  }

  return NextResponse.json({ ok: true, items: data ?? [] });
}

export async function POST(req: Request) {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ ok: false, error: 'Please sign in again.' }, { status: 401 });
  }

  const householdId = await getLatestHouseholdIdForUser(supabase, user.id);
  if (!householdId) {
    return NextResponse.json({ ok: false, error: 'This action is not allowed.' }, { status: 403 });
  }

  const body = (await req.json()) as { email?: string; role?: string };
  const email = String(body?.email ?? '').trim().toLowerCase();
  if (!email.includes('@')) {
    return NextResponse.json({ ok: false, error: 'Please enter a valid email address.' }, { status: 400 });
  }

  const role = normalizeRole(body?.role);

  const { data: membership } = await supabase
    .from('household_members')
    .select('role')
    .eq('household_id', householdId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!membership || !['owner', 'admin'].includes(membership.role)) {
    return NextResponse.json({ ok: false, error: 'This action is not allowed.' }, { status: 403 });
  }

  const { data: invite, error } = await supabase
    .from('household_invites')
    .insert({
      household_id: householdId,
      email,
      role,
      invited_by: user.id,
      status: 'pending',
    })
    .select('invite_token')
    .single();

  if (error || !invite?.invite_token) {
    const message = error && /duplicate key|unique/i.test(error.message)
      ? 'An invite is already pending for this email.'
      : 'Unable to send invite right now.';
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }

  const mail = await sendInviteEmail({ email, role, inviteToken: invite.invite_token as string });
  return NextResponse.json({ ok: true, email_sent: mail.ok, email_error: mail.ok ? null : mail.reason });
}
