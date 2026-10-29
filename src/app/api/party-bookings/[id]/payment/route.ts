import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { getLatestHouseholdIdForUser } from '@/lib/households';
import { reconcilePartyInvoice, type InvoiceBooking } from '@/lib/square-party';
import { onlinePaymentsUnavailable } from '@/lib/online-payment-access';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const unavailable = onlinePaymentsUnavailable('party');
  if (unavailable) return unavailable;
  const server = await createServerSupabaseClient();
  const { data: { user } } = await server.auth.getUser();
  if (!user) return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  try {
    const admin = createAdminSupabaseClient();
    const householdId = await getLatestHouseholdIdForUser(admin, user.id);
    const { data, error } = await admin.from('party_bookings').select('*').eq('id', (await params).id).eq('household_id', householdId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data?.square_invoice_id) return Response.json({ ok: false, error: 'Invoice not found' }, { status: 404 });
    const booking = await reconcilePartyInvoice(admin, data as InvoiceBooking);
    return Response.json({ ok: true, status: booking.status,start_time:booking.start_time,end_time:booking.end_time, deposit_paid_cents: booking.deposit_paid_cents,
      balance_paid_cents: booking.balance_paid_cents, payment_review_required: booking.payment_review_required,
      payment_url: booking.square_invoice_url }, { headers: { 'cache-control': 'no-store' } });
  } catch {
    return Response.json({ ok: false, error: 'Unable to verify payment. Please try again.' }, { status: 502 });
  }
}
