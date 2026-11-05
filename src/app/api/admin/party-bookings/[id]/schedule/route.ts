import { requireOwnerContext } from '@/lib/authz';
import { isUuid } from '@/lib/open-play-reservations';
import { parsePartySchedule } from '@/lib/party-management';

export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await requireOwnerContext();
  if (!context.ok) return context.response;
  const { id } = await params;
  if (!isUuid(id)) return Response.json({ ok: false, error: 'Invalid booking ID.' }, { status: 400 });

  let body;
  try { body = await req.json(); }
  catch { return Response.json({ ok: false, error: 'Invalid request.' }, { status: 400 }); }
  const schedule = parsePartySchedule(body?.date, body?.start_time, body?.end_time);
  if (!schedule) return Response.json({ ok: false, error: 'Choose a valid date and an end time after the start time (Eastern Time).' }, { status: 400 });
  if (typeof body?.expected_start_time !== 'string' || !Number.isFinite(Date.parse(body.expected_start_time))
    || typeof body?.expected_end_time !== 'string' || !Number.isFinite(Date.parse(body.expected_end_time))) {
    return Response.json({ ok: false, error: 'Refresh the party before changing its schedule.' }, { status: 400 });
  }

  try {
    const { data: booking, error } = await context.admin.from('party_bookings')
      .select('id,start_time,end_time,status').eq('id', id).maybeSingle();
    if (error) throw error;
    if (!booking) return Response.json({ ok: false, error: 'Party booking not found.' }, { status: 404 });
    if (booking.status === 'cancelled' || new Date(booking.end_time).getTime() <= Date.now()) {
      return Response.json({ ok: false, error: 'Completed or cancelled parties cannot be rescheduled.' }, { status: 409 });
    }
    if (Date.parse(booking.start_time) !== Date.parse(body.expected_start_time)
      || Date.parse(booking.end_time) !== Date.parse(body.expected_end_time)) {
      return Response.json({ ok: false, error: 'This party’s schedule changed. Refresh and try again.' }, { status: 409 });
    }
    if (new Date(schedule.end_time).getTime() <= Date.now()) {
      return Response.json({ ok: false, error: 'Choose a party schedule that has not already ended.' }, { status: 400 });
    }
    const { data: conflicts, error: conflictError } = await context.admin.from('party_bookings')
      .select('id').neq('id', id).neq('status', 'cancelled')
      .lt('start_time', schedule.end_time).gt('end_time', schedule.start_time).limit(1);
    if (conflictError) throw conflictError;
    if (conflicts?.length) return Response.json({ ok: false, error: 'Another party is already booked during this time. Choose a different date or time.' }, { status: 409 });

    const { data: item, error: updateError } = await context.admin.from('party_bookings')
      .update({ ...schedule, updated_at: new Date().toISOString() })
      .eq('id', id).eq('start_time', booking.start_time).eq('end_time', booking.end_time).eq('status', booking.status)
      .select('id,start_time,end_time').maybeSingle();
    if (updateError) {
      if (updateError.code === '23P01') return Response.json({ ok: false, error: 'Another party is already booked during this time.' }, { status: 409 });
      throw updateError;
    }
    if (!item) return Response.json({ ok: false, error: 'This party changed while saving. Refresh and try again.' }, { status: 409 });
    return Response.json({ ok: true, item });
  } catch {
    return Response.json({ ok: false, error: 'Unable to save the party schedule. Please try again.' }, { status: 500 });
  }
}
