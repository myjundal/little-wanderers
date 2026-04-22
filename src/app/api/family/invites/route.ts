import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getLatestHouseholdIdForUser } from '@/lib/households';

function normalizeRole(input: unknown): 'admin' | 'member' {
  return input === 'admin' ? 'admin' : 'member';
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

  const { error } = await supabase.from('household_invites').insert({
    household_id: householdId,
    email,
    role,
    invited_by: user.id,
    status: 'pending',
  });

  if (error) {
    const message = /duplicate key|unique/i.test(error.message)
      ? 'An invite is already pending for this email.'
      : 'Unable to send invite right now.';
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
