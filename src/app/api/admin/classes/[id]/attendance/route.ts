import { requireStaffContext } from '@/lib/authz';

export const dynamic = 'force-dynamic';

const ALLOWED = new Set(['unknown', 'attended', 'cancelled', 'no_show']);

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const context = await requireStaffContext();
  if (!context.ok) return context.response;

  try {
    const body = (await req.json()) as { registration_id?: string; attendance_status?: string };
    const registrationId = typeof body.registration_id === 'string' ? body.registration_id : '';
    const attendanceStatus = typeof body.attendance_status === 'string' ? body.attendance_status : '';

    if (!registrationId) return Response.json({ ok: false, error: 'registration_id is required' }, { status: 400 });
    if (!ALLOWED.has(attendanceStatus)) return Response.json({ ok: false, error: 'invalid attendance_status' }, { status: 400 });

    const { data: registration, error: regErr } = await context.admin
      .from('class_registrations')
      .select('id,class_id')
      .eq('id', registrationId)
      .maybeSingle();

    if (regErr) return Response.json({ ok: false, error: regErr.message }, { status: 500 });
    if (!registration || registration.class_id !== params.id) {
      return Response.json({ ok: false, error: 'registration not found for class' }, { status: 404 });
    }

    const updatePayload = {
      attendance_status: attendanceStatus,
      attendance_marked_at: new Date().toISOString(),
      attendance_marked_by: context.user.id,
    };

    const primary = await context.admin.from('class_registrations').update(updatePayload).eq('id', registrationId);

    if (primary.error) {
      if (!/column .* does not exist|Could not find the '.*' column/i.test(primary.error.message)) {
        return Response.json({ ok: false, error: primary.error.message }, { status: 500 });
      }
      return Response.json({ ok: false, error: 'Attendance columns are missing. Run latest SQL migration first.' }, { status: 409 });
    }

    return Response.json({ ok: true });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'unknown error';
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
