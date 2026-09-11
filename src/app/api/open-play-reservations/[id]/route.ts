import { NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getLatestHouseholdIdForUser } from '@/lib/households';
import {
  formatOpenPlayReservationError,
  isMissingOpenPlayReservationTable,
  isUuid,
  OPEN_PLAY_RESERVATION_SELECT,
} from '@/lib/open-play-reservations';

export const dynamic = 'force-dynamic';

const NO_STORE_HEADERS = { 'cache-control': 'no-store, max-age=0' };

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const body = (await req.json().catch(() => null)) as { action?: string } | null;
    if (body?.action !== 'cancel') {
      return NextResponse.json({ ok: false, error: 'invalid action' }, { status: 400, headers: NO_STORE_HEADERS });
    }
    if (!isUuid(params.id)) {
      return NextResponse.json({ ok: false, error: 'invalid reservation id' }, { status: 400, headers: NO_STORE_HEADERS });
    }

    const server = createServerSupabaseClient();
    const {
      data: { user },
    } = await server.auth.getUser();

    if (!user) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401, headers: NO_STORE_HEADERS });

    const admin = createAdminSupabaseClient();
    const householdId = await getLatestHouseholdIdForUser(admin, user.id);
    if (!householdId) {
      return NextResponse.json({ ok: false, error: 'household not found' }, { status: 404, headers: NO_STORE_HEADERS });
    }

    const { data: reservation, error: reservationError } = await admin
      .from('open_play_reservations')
      .select(OPEN_PLAY_RESERVATION_SELECT)
      .eq('id', params.id)
      .eq('household_id', householdId)
      .maybeSingle();

    if (reservationError) throw new Error(reservationError.message);
    if (!reservation) {
      return NextResponse.json({ ok: false, error: 'reservation not found' }, { status: 404, headers: NO_STORE_HEADERS });
    }
    if (reservation.status === 'cancelled') {
      return NextResponse.json({ ok: true, reservation, already_cancelled: true }, { headers: NO_STORE_HEADERS });
    }
    if (reservation.status !== 'reserved') {
      return NextResponse.json({ ok: false, error: `This reservation is already marked ${reservation.status}.` }, { status: 409, headers: NO_STORE_HEADERS });
    }

    const now = new Date().toISOString();
    const { data: updated, error: updateError } = await admin
      .from('open_play_reservations')
      .update({
        status: 'cancelled',
        cancelled_at: now,
        cancelled_by_user_id: user.id,
        status_updated_at: now,
      })
      .eq('id', params.id)
      .eq('household_id', householdId)
      .select(OPEN_PLAY_RESERVATION_SELECT)
      .maybeSingle();

    if (updateError) throw new Error(updateError.message);

    return NextResponse.json({ ok: true, reservation: updated }, { headers: NO_STORE_HEADERS });
  } catch (e: unknown) {
    const rawMessage = e instanceof Error ? e.message : 'unknown error';
    const status = isMissingOpenPlayReservationTable(rawMessage) ? 503 : 500;
    return NextResponse.json({ ok: false, error: formatOpenPlayReservationError(rawMessage) }, { status, headers: NO_STORE_HEADERS });
  }
}
