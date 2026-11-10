import { requireOwnerContext, requireStaffContext } from '@/lib/authz';
import { isUuid, OPEN_PLAY_SLOT_SELECT, OPEN_PLAY_RESERVATION_SELECT, SOFT_OPENING_END } from '@/lib/open-play-reservations';
import { readSoftOpeningFamily } from '@/lib/soft-opening-family';
import { createStaffOpenPlayReservation } from '@/lib/staff-open-play';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };
type Params = { params: Promise<{ id: string }> };
export async function GET(_req: Request, { params }: Params) {
  const c = await requireStaffContext(); if (!c.ok) return c.response;
  const { id } = await params;
  if (!isUuid(id)) return Response.json({ ok: false }, { status: 400, headers });
  try {
    const [family, slots, reservations] = await Promise.all([
      readSoftOpeningFamily(c.admin, id),
      c.admin.from('open_play_reservation_slots').select(OPEN_PLAY_SLOT_SELECT).eq('is_soft_opening', true).eq('status', 'open').gt('ends_at', new Date().toISOString()).lt('starts_at', SOFT_OPENING_END).order('starts_at'),
      c.admin.from('open_play_reservations').select(`${OPEN_PLAY_RESERVATION_SELECT},slot:open_play_reservation_slots(${OPEN_PLAY_SLOT_SELECT})`).eq('household_id', id).order('created_at', { ascending: false }),
    ]);
    if (slots.error || reservations.error) throw new Error();
    const occupancy = slots.data?.length ? await c.admin.from('open_play_reservations').select('slot_id,child_count,adult_count').in('slot_id', slots.data.map(s => s.id)).neq('status', 'cancelled') : { data: [], error: null };
    if (occupancy.error) throw new Error();
    return Response.json({ ok: true, family, reservations: reservations.data, slots: slots.data.map(slot => {
      const rows = occupancy.data.filter(r => r.slot_id === slot.id);
      return { ...slot, remaining_children: Math.max(0, slot.capacity_children - rows.reduce((n, r) => n + r.child_count, 0)), remaining_total: slot.capacity_total == null ? null : Math.max(0, slot.capacity_total - rows.reduce((n, r) => n + r.child_count + r.adult_count, 0)) };
    }) }, { headers });
  } catch { return Response.json({ ok: false, error: 'Unable to load Open Play reservations.' }, { status: 503, headers }); }
}
export async function POST(req: Request, { params }: Params) {
  const c = await requireOwnerContext(); if (!c.ok) return c.response;
  const { id } = await params;
  try {
    const reservation = await createStaffOpenPlayReservation(c.admin, id, c.user.id, await req.json());
    return Response.json({ ok: true, reservation }, { headers });
  } catch (error) { return Response.json({ ok: false, error: error instanceof Error ? error.message : 'Unable to save the reservation.' }, { status: 409, headers }); }
}
