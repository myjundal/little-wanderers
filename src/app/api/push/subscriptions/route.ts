import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getLatestHouseholdIdForUser } from '@/lib/households';

export async function POST(req: Request) {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ ok: false, error: 'Please sign in again.' }, { status: 401 });

  const householdId = await getLatestHouseholdIdForUser(supabase, user.id);
  if (!householdId) return NextResponse.json({ ok: false, error: 'This action is not allowed.' }, { status: 403 });

  const body = (await req.json()) as {
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
  };

  const endpoint = String(body?.endpoint ?? '').trim();
  const p256dh = String(body?.keys?.p256dh ?? '').trim();
  const auth = String(body?.keys?.auth ?? '').trim();

  if (!endpoint || !p256dh || !auth) {
    return NextResponse.json({ ok: false, error: 'Invalid subscription payload.' }, { status: 400 });
  }

  const { error } = await supabase.from('push_subscriptions').upsert(
    {
      household_id: householdId,
      user_id: user.id,
      endpoint,
      p256dh_key: p256dh,
      auth_key: auth,
      enabled: true,
    },
    { onConflict: 'endpoint' }
  );

  if (error) return NextResponse.json({ ok: false, error: 'Unable to save notification preference.' }, { status: 500 });

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ ok: false, error: 'Please sign in again.' }, { status: 401 });

  const body = (await req.json()) as { endpoint?: string };
  const endpoint = String(body?.endpoint ?? '').trim();
  if (!endpoint) return NextResponse.json({ ok: false, error: 'endpoint required' }, { status: 400 });

  const { error } = await supabase.from('push_subscriptions').delete().eq('user_id', user.id).eq('endpoint', endpoint);
  if (error) return NextResponse.json({ ok: false, error: 'Unable to disable notifications.' }, { status: 500 });

  return NextResponse.json({ ok: true });
}
