import { requireOwnerContext } from '@/lib/authz';

export const dynamic = 'force-dynamic';

const ALLOWED_STATUSES = new Set(['pending', 'confirmed', 'cancelled', 'early_access_hold']);

export async function PATCH(req: Request, { params: pendingParams }: { params: Promise<{ id: string }> }) {
  const params = await pendingParams;
  const context = await requireOwnerContext();
  if (!context.ok) return context.response;

  try {
    const body = await req.json();
    const nextStatus = typeof body?.status === 'string' ? body.status : '';

    if (!ALLOWED_STATUSES.has(nextStatus)) {
      return Response.json({ ok: false, error: 'invalid status' }, { status: 400 });
    }

    const { data: booking, error: bookingErr } = await context.admin
      .from('party_bookings')
      .select('*')
      .eq('id', params.id)
      .maybeSingle();

    if (bookingErr) {
      return Response.json({ ok: false, error: bookingErr.message }, { status: 500 });
    }

    if (!booking) {
      return Response.json({ ok: false, error: 'booking not found' }, { status: 404 });
    }

    if (booking.square_environment && booking.status === 'pending' && nextStatus !== 'pending') {
      const { closePartyCheckout, reconcilePartyCheckout, partyCheckoutFromBooking } = await import('@/lib/party-deposit');
      const checkout = partyCheckoutFromBooking(booking);
      const verified = await (nextStatus === 'cancelled' ? closePartyCheckout(context.admin, checkout) : reconcilePartyCheckout(context.admin, checkout));
      if (verified.status !== (nextStatus === 'cancelled' ? 'cancelled' : 'completed')) {
        return Response.json({ ok: false, error: 'Verify the deposit or resolve the invoice in Square before changing this booking.' }, { status: 409 });
      }
      return Response.json({ ok: true });
    }

    if (booking.square_invoice_id && booking.status === 'confirmed' && nextStatus === 'cancelled') {
      const { reconcilePartyInvoice } = await import('@/lib/square-party');
      const verified = await reconcilePartyInvoice(context.admin, booking);
      if (!['CANCELED', 'PAID', 'REFUNDED'].includes(verified.square_invoice_status ?? '')) {
        return Response.json({ ok: false, error: 'Close or resolve the outstanding Square invoice before cancelling this party. The date is still held.' }, { status: 409 });
      }
    }

    const currentStatus = booking.status ?? 'pending';
    const validTransition =
      nextStatus === currentStatus ||
      (currentStatus === 'pending' && (nextStatus === 'confirmed' || nextStatus === 'cancelled')) ||
      (currentStatus === 'early_access_hold' && (nextStatus === 'confirmed' || nextStatus === 'cancelled')) ||
      (currentStatus === 'confirmed' && nextStatus === 'cancelled');

    if (!validTransition) {
      return Response.json({ ok: false, error: `Cannot change ${currentStatus} to ${nextStatus}` }, { status: 409 });
    }

    const { error: updateErr } = await context.admin
      .from('party_bookings')
      .update({ status: nextStatus, status_updated_at: new Date().toISOString() })
      .eq('id', params.id).eq('status', booking.status);

    if (updateErr) {
      return Response.json({ ok: false, error: updateErr.message }, { status: 500 });
    }

    return Response.json({ ok: true });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'unknown error';
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
