import { requireOwnerContext } from '@/lib/authz';
import { repairOpenPlayMembership } from '@/lib/open-play-membership-repair';
import { isSameOriginRequest } from '@/lib/request-origin';
import {
  formatOpenPlayReservationError,
  isMissingOpenPlayReservationTable,
  isUuid,
  OPEN_PLAY_RESERVATION_SELECT,
} from '@/lib/open-play-reservations';

export const dynamic = 'force-dynamic';

const NO_STORE_HEADERS = { 'cache-control': 'no-store, max-age=0' };
const ALLOWED_STATUSES = new Set(['reserved', 'cancelled', 'checked_in', 'no_show']);

export async function PATCH(req: Request, { params: pendingParams }: { params: Promise<{ id: string }> }) {
  const params = await pendingParams;
  const context = await requireOwnerContext();
  if (!context.ok) return context.response;

  try {
    if (!isUuid(params.id)) {
      return Response.json({ ok: false, error: 'invalid reservation id' }, { status: 400, headers: NO_STORE_HEADERS });
    }

    const body = (await req.json().catch(() => null)) as { status?: string; action?: string } | null;
    if (body?.action === 'apply_membership') {
      if (!isSameOriginRequest(req)) return Response.json({ ok: false, error: 'Invalid request origin.' }, { status: 403, headers: NO_STORE_HEADERS });
      try {
        const reservation = await repairOpenPlayMembership(context.admin, params.id, context.user.id);
        return Response.json({ ok: true, reservation }, { headers: NO_STORE_HEADERS });
      } catch (error) {
        return Response.json({ ok: false, error: error instanceof Error && !error.message.startsWith('Square request') ? error.message : 'Unable to verify the checkout. No new payment was created.' }, { status: 409, headers: NO_STORE_HEADERS });
      }
    }
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

    if (error?.code === '23514' || error?.code === '23505') {
      return Response.json({ ok: false, error: error.message }, { status: 409, headers: NO_STORE_HEADERS });
    }
    if (error) throw new Error(error.message);
    if (!data) return Response.json({ ok: false, error: 'reservation not found' }, { status: 404, headers: NO_STORE_HEADERS });

    return Response.json({ ok: true, reservation: data }, { headers: NO_STORE_HEADERS });
  } catch (e: unknown) {
    const rawMessage = e instanceof Error ? e.message : 'unknown error';
    const status = isMissingOpenPlayReservationTable(rawMessage) ? 503 : 500;
    return Response.json({ ok: false, error: formatOpenPlayReservationError(rawMessage) }, { status, headers: NO_STORE_HEADERS });
  }
}
