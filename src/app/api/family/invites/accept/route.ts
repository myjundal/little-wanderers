import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';

function normalizeHouseholdRole(inviteRole: string) {
  return inviteRole === 'admin' ? 'admin' : 'member';
}

export async function POST(req: Request) {
  const server = createServerSupabaseClient();
  const {
    data: { user },
  } = await server.auth.getUser();

  if (!user) {
    return NextResponse.json({ ok: false, error: 'Please sign in again.' }, { status: 401 });
  }

  const body = (await req.json()) as { token?: string };
  const token = String(body?.token ?? '').trim();
  if (!token) {
    return NextResponse.json({ ok: false, error: 'Invite token is required.' }, { status: 400 });
  }

  const admin = createAdminSupabaseClient();

  const { data: invite, error: inviteError } = await admin
    .from('household_invites')
    .select('id,household_id,email,role,status,expires_at')
    .eq('invite_token', token)
    .maybeSingle();

  if (inviteError || !invite) {
    return NextResponse.json({ ok: false, error: 'Invite not found.' }, { status: 404 });
  }

  if (invite.status !== 'pending') {
    return NextResponse.json({ ok: false, error: 'This invite is no longer active.' }, { status: 400 });
  }

  if (new Date(invite.expires_at).getTime() < Date.now()) {
    await admin.from('household_invites').update({ status: 'expired' }).eq('id', invite.id);
    return NextResponse.json({ ok: false, error: 'This invite has expired.' }, { status: 400 });
  }

  const userEmail = (user.email ?? '').toLowerCase().trim();
  const inviteEmail = String(invite.email ?? '').toLowerCase().trim();
  if (!userEmail || userEmail !== inviteEmail) {
    return NextResponse.json({ ok: false, error: 'This invite belongs to a different account email.' }, { status: 403 });
  }

  const mappedRole = normalizeHouseholdRole(invite.role);

  const { error: memberError } = await admin.from('household_members').upsert(
    {
      household_id: invite.household_id,
      user_id: user.id,
      role: mappedRole,
    },
    { onConflict: 'household_id,user_id' }
  );

  if (memberError) {
    return NextResponse.json({ ok: false, error: 'Unable to add you to this household right now.' }, { status: 500 });
  }

  const { error: markError } = await admin
    .from('household_invites')
    .update({ status: 'accepted', accepted_at: new Date().toISOString(), accepted_by_user_id: user.id })
    .eq('id', invite.id);

  if (markError) {
    return NextResponse.json({ ok: false, error: 'Unable to complete invite acceptance.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
