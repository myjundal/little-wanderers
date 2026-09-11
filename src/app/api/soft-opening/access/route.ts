import { NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getSoftOpeningAccessForUser } from '@/lib/soft-opening-access';

export const dynamic = 'force-dynamic';

const NO_STORE_HEADERS = { 'cache-control': 'no-store, max-age=0' };

export async function GET() {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ ok: false, allowed: false, error: 'Please sign in to view soft opening access.' }, { status: 401, headers: NO_STORE_HEADERS });
  }

  const admin = createAdminSupabaseClient();

  try {
    const access = await getSoftOpeningAccessForUser(admin, user);

    return NextResponse.json({
      ok: true,
      allowed: access.allowed,
      access: {
        on_wanderlist: access.on_wanderlist,
        party_early_access: access.party_early_access,
        has_party_booking: access.has_party_booking,
      },
      email: access.email,
    }, { headers: NO_STORE_HEADERS });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Unable to check soft opening access right now.';
    return NextResponse.json({ ok: false, allowed: false, error: message }, { status: 500, headers: NO_STORE_HEADERS });
  }
}
