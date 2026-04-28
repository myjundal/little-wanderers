import { requireStaffContext } from '@/lib/authz';

export const dynamic = 'force-dynamic';

type Action =
  | 'increment_child'
  | 'decrement_child'
  | 'increment_adult'
  | 'decrement_adult'
  | 'finalize'
  | 'reopen';

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const context = await requireStaffContext();
  if (!context.ok) return context.response;

  try {
    const body = (await req.json().catch(() => ({}))) as { action?: Action; notes?: string | null };
    const action = body.action ?? 'increment_child';

    const { data: booking, error: bookingErr } = await context.admin
      .from('party_bookings')
      .select('id,current_child_count,current_adult_count,attendance_finalized_at')
      .eq('id', params.id)
      .maybeSingle();

    if (bookingErr) {
      if (/column .* does not exist|Could not find the '.*' column/i.test(bookingErr.message)) {
        return Response.json({ ok: false, error: 'Party attendance columns are missing. Run latest SQL migration first.' }, { status: 409 });
      }
      return Response.json({ ok: false, error: bookingErr.message }, { status: 500 });
    }
    if (!booking) return Response.json({ ok: false, error: 'booking not found' }, { status: 404 });

    const child = Number(booking.current_child_count ?? 0);
    const adult = Number(booking.current_adult_count ?? 0);
    const isFinalized = Boolean(booking.attendance_finalized_at);

    if (isFinalized && action !== 'reopen') {
      return Response.json({ ok: false, error: 'attendance already finalized. reopen first.' }, { status: 409 });
    }

    let payload: Record<string, unknown>;
    switch (action) {
      case 'increment_child':
        payload = { current_child_count: child + 1 };
        break;
      case 'decrement_child':
        payload = { current_child_count: Math.max(child - 1, 0) };
        break;
      case 'increment_adult':
        payload = { current_adult_count: adult + 1 };
        break;
      case 'decrement_adult':
        payload = { current_adult_count: Math.max(adult - 1, 0) };
        break;
      case 'finalize': {
        const finalChild = child;
        const finalAdult = adult;
        payload = {
          final_child_count: finalChild,
          final_adult_count: finalAdult,
          final_total_count: finalChild + finalAdult,
          attendance_finalized_at: new Date().toISOString(),
          attendance_recorded_by: context.user.id,
          attendance_notes: typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim().slice(0, 2000) : null,
        };
        break;
      }
      case 'reopen':
        payload = {
          attendance_finalized_at: null,
          final_child_count: null,
          final_adult_count: null,
          final_total_count: null,
          attendance_recorded_by: null,
        };
        break;
      default:
        return Response.json({ ok: false, error: 'invalid action' }, { status: 400 });
    }

    const { error: updateErr } = await context.admin.from('party_bookings').update(payload).eq('id', params.id);
    if (updateErr) return Response.json({ ok: false, error: updateErr.message }, { status: 500 });

    return Response.json({ ok: true });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'unknown error';
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
