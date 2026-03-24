import { requireStaffContext } from '@/lib/authz';

export const dynamic = 'force-dynamic';

export async function PATCH(_req: Request, { params }: { params: { id: string } }) {
  const context = await requireStaffContext();
  if (!context.ok) return context.response;

  try {
    const { data: booking, error: bookingErr } = await context.admin
      .from('party_bookings')
      .select('id,notes')
      .eq('id', params.id)
      .maybeSingle();

    if (bookingErr) return Response.json({ ok: false, error: bookingErr.message }, { status: 500 });
    if (!booking) return Response.json({ ok: false, error: 'booking not found' }, { status: 404 });

    const already = (booking.notes ?? '').includes('[Final headcount received');
    if (already) return Response.json({ ok: true, already_received: true });

    const notes = `${booking.notes ?? ''}\n[Final headcount received at ${new Date().toISOString()}]`.trim();
    const { error } = await context.admin
      .from('party_bookings')
      .update({ notes, status_updated_at: new Date().toISOString() })
      .eq('id', params.id);

    if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
    return Response.json({ ok: true });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'unknown error';
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
