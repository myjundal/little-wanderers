import { reconcileOpenPlayPayments } from '@/lib/soft-opening-payments';
import { requireStaffContext } from '@/lib/authz';
import { WAIVER_VERSION } from '@/lib/waiver-content';
import { isUuid } from '@/lib/open-play-reservations';

export async function POST(req: Request) {
  const context = await requireStaffContext();
  if (!context.ok) return context.response;
  const body = await req.json().catch(() => null);
  if (!isUuid(String(body?.person_id ?? ''))) return Response.json({ ok: false, error: 'A valid person_id is required.' }, { status: 400 });
  const person = await context.admin.from('people').select('household_id').eq('id',body.person_id).maybeSingle();
  if (person.error) return Response.json({ok:false,error:'Unable to verify admission payment.'},{status:503});
  if (person.data) { try { await reconcileOpenPlayPayments(context.admin,person.data.household_id); } catch { return Response.json({ok:false,error:'Online admission payment needs review before check-in. Please verify it before collecting payment.'},{status:503}); } }
  // A QR identifies one person. Ignore caller-provided prices, headcounts and audit identity.
  const { data, error } = await context.admin.rpc('checkin_person', {
    p_person_id: body.person_id, p_staff_user_id: context.user.id, p_staff_role: context.role,
    p_source: body.source === 'staff_manual' ? 'staff_manual' : 'qr', p_waiver_version: WAIVER_VERSION,
  });
  if (error) return Response.json({ ok: false, error: 'Unable to record check-in. Please try again.' }, { status: 503 });
  if (data?.ok && data.checkin_id) {
    const saved = await context.admin.from('checkins').select('price_cents,payment_status').eq('id',data.checkin_id).single();
    if (saved.error) return Response.json({ok:false,error:'Check-in saved. Refresh before collecting payment.'},{status:503});
    data.price_cents = saved.data.price_cents;
    data.payment_status = saved.data.payment_status;
  }
  const status = data?.ok ? 200 : data?.code === 'not_found' ? 404 : data?.code === 'forbidden' ? 403 : 409;
  return Response.json(data, { status });
}
