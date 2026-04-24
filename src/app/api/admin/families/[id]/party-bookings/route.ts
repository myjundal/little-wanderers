import { requireStaffContext } from '@/lib/authz';

type Params = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Params) {
  const context = await requireStaffContext();
  if (!context.ok) return context.response;

  const { id: householdId } = await params;
  const body = await req.json();
  const start = new Date(body.start_time);
  const end = new Date(body.end_time);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    return Response.json({ ok: false, error: 'invalid time range' }, { status: 400 });
  }

  const admin = context.admin;
  const { data: conflicts } = await admin
    .from('party_bookings')
    .select('id')
    .lt('start_time', end.toISOString())
    .gt('end_time', start.toISOString())
    .neq('status', 'cancelled');

  if ((conflicts ?? []).length > 0) {
    return Response.json({ ok: false, error: 'That party slot is already booked.' }, { status: 409 });
  }

  const { data, error } = await admin
    .from('party_bookings')
    .insert({
      household_id: householdId,
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      headcount_expected: body.headcount_expected ? Number(body.headcount_expected) : null,
      notes: body.notes ?? null,
      status: 'confirmed',
      status_updated_at: new Date().toISOString(),
      created_by_user_id: context.user.id,
      created_by_role: 'owner',
    })
    .select('id')
    .maybeSingle();

  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  return Response.json({ ok: true, id: data?.id ?? null });
}
