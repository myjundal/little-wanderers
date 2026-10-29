import { requireStaffContext } from '@/lib/authz';
import { onlinePaymentsUnavailable } from '@/lib/online-payment-access';
import { startPartyInvoice } from '@/lib/square-party';
import { isBookablePartySlot, isOnOrAfterPartyBookingStart, PARTY_BOOKING_START_LABEL } from '@/lib/party-config';

type Params = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params: pendingParams }: Params) {
  const params = await pendingParams;
  const context = await requireStaffContext();
  if (!context.ok) return context.response;

  const unavailable = onlinePaymentsUnavailable('party');
  if (unavailable) return unavailable;
  const { id: householdId } = params;
  const body = await req.json();
  const start = new Date(body.start_time);
  const end = new Date(body.end_time);
  const birthdayChildName = typeof body.birthday_child_name === 'string' ? body.birthday_child_name.trim().slice(0, 80) : null;
  const birthdayAge = body.birthday_age == null ? null : Number(body.birthday_age);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    return Response.json({ ok: false, error: 'invalid time range' }, { status: 400 });
  }
  if (birthdayAge != null && (!Number.isInteger(birthdayAge) || birthdayAge <= 0 || birthdayAge > 21)) {
    return Response.json({ ok: false, error: 'birthday_age must be a positive whole number' }, { status: 400 });
  }
  if (!isOnOrAfterPartyBookingStart(start)) {
    return Response.json({ ok: false, error: `Party bookings are available starting ${PARTY_BOOKING_START_LABEL}.` }, { status: 400 });
  }
  if (!isBookablePartySlot(start, end)) {
    return Response.json({ ok: false, error: 'Party bookings are only available on Friday afternoons, Saturdays, or Sundays.' }, { status: 400 });
  }

  try {
    const admin = context.admin;
    const { data: household, error } = await admin.from('households').select('email').eq('id',householdId).single();
    if (error) throw new Error(error.message);
    const result = await startPartyInvoice(admin, { householdId,userId:context.user.id,role:context.role,email:household.email,
      booking: { start_time:start.toISOString(),end_time:end.toISOString(),headcount_expected:body.headcount_expected ?? null,
        birthday_child_name:birthdayChildName,birthday_age:birthdayAge,notes:body.notes ?? null } });
    return Response.json({ ok:true,id:result.booking.id,status:result.booking.status,payment_url:result.url });
  } catch (error) {
    return Response.json({ ok:false,error:error instanceof Error ? error.message : 'Unable to start party invoice' }, { status:409 });
  }
}
