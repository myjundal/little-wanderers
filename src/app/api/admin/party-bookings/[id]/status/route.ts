import { requireStaffContext } from '@/lib/authz';

const ALLOWED_STATUSES = new Set(['pending', 'confirmed', 'cancelled']);

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const context = await requireStaffContext();
  if (!context.ok) return context.response;

  try {
    const body = await req.json();
    const nextStatus = typeof body?.status === 'string' ? body.status : '';
    const notes = typeof body?.notes === 'string' && body.notes.trim() ? body.notes.trim() : null;

    if (!ALLOWED_STATUSES.has(nextStatus)) {
      return Response.json({ ok: false, error: 'invalid status' }, { status: 400 });
    }

    const { data: booking, error: bookingErr } = await context.admin
      .from('party_bookings')
      .select('id,status')
      .eq('id', params.id)
      .maybeSingle();

    if (bookingErr) {
      return Response.json({ ok: false, error: bookingErr.message }, { status: 500 });
    }

    if (!booking) {
      return Response.json({ ok: false, error: 'booking not found' }, { status: 404 });
    }

    const currentStatus = booking.status ?? 'pending';
    const validTransition =
      nextStatus === currentStatus ||
      (currentStatus === 'pending' && (nextStatus === 'confirmed' || nextStatus === 'cancelled')) ||
      (currentStatus === 'confirmed' && nextStatus === 'cancelled');

    if (!validTransition) {
      return Response.json({ ok: false, error: `Cannot change ${currentStatus} to ${nextStatus}` }, { status: 409 });
    }

    const { error: updateErr } = await context.admin
      .from('party_bookings')
      .update({ status: nextStatus, status_updated_at: new Date().toISOString() })
      .eq('id', params.id);

    if (updateErr) {
      return Response.json({ ok: false, error: updateErr.message }, { status: 500 });
    }

    const { error: eventErr } = await context.admin.from('party_booking_events').insert({
      party_booking_id: params.id,
      from_status: currentStatus,
      to_status: nextStatus,
      notes,
      changed_by: context.user.id,
    });

    if (eventErr) {
      return Response.json({ ok: false, error: eventErr.message }, { status: 500 });
    }

    return Response.json({ ok: true });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'unknown error';
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
