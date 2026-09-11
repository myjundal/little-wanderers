import { requireStaffContext } from '@/lib/authz';
import {
  formatOpenPlayReservationError,
  isMissingOpenPlayReservationTable,
  isUuid,
  OPEN_PLAY_RESERVATION_SELECT,
} from '@/lib/open-play-reservations';

export const dynamic = 'force-dynamic';

const NO_STORE_HEADERS = { 'cache-control': 'no-store, max-age=0' };
const ALLOWED_STATUSES = new Set(['reserved', 'cancelled', 'checked_in', 'no_show']);

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const context = await requireStaffContext();
  if (!context.ok) return context.response;

  try {
    if (!isUuid(params.id)) {
      return Response.json({ ok: false, error: 'invalid reservation id' }, { status: 400, headers: NO_STORE_HEADERS });
    }

    const body = (await req.json().catch(() => null)) as { status?: string } | null;
    const status = typeof body?.status === 'string' ? body.status : '';
    if (!ALLOWED_STATUSES.has(status)) {
      return Response.json({ ok: false, error: 'invalid status' }, { status: 400, headers: NO_STORE_HEADERS });
    }

    const now = new Date().toISOString();
    const payload = status === 'cancelled'
      ? { status, cancelled_at: now, cancelled_by_user_id: context.user.id, status_updated_at: now }
      : { status, cancelled_at: null, cancelled_by_user_id: null, status_updated_at: now };

    const { data, error } = await context.admin
      .from('open_play_reservations')
      .update(payload)
      .eq('id', params.id)
      .select(OPEN_PLAY_RESERVATION_SELECT)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) return Response.json({ ok: false, error: 'reservation not found' }, { status: 404, headers: NO_STORE_HEADERS });

    return Response.json({ ok: true, reservation: data }, { headers: NO_STORE_HEADERS });
  } catch (e: unknown) {
    const rawMessage = e instanceof Error ? e.message : 'unknown error';
    const status = isMissingOpenPlayReservationTable(rawMessage) ? 503 : 500;
    return Response.json({ ok: false, error: formatOpenPlayReservationError(rawMessage) }, { status, headers: NO_STORE_HEADERS });
  }
}
