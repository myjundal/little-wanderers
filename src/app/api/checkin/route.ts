import { requireStaffContext } from '@/lib/authz';
import { WAIVER_VERSION } from '@/lib/waiver-content';
import { isUuid } from '@/lib/open-play-reservations';

export async function POST(req: Request) {
  const context = await requireStaffContext();
  if (!context.ok) return context.response;
  const body = await req.json().catch(() => null);
  if (!isUuid(String(body?.person_id ?? ''))) return Response.json({ ok: false, error: 'A valid person_id is required.' }, { status: 400 });
  // A QR identifies one person. Ignore caller-provided prices, headcounts and audit identity.
  const { data, error } = await context.admin.rpc('checkin_person', {
    p_person_id: body.person_id, p_staff_user_id: context.user.id, p_staff_role: context.role,
    p_source: body.source === 'staff_manual' ? 'staff_manual' : 'qr', p_waiver_version: WAIVER_VERSION,
  });
  if (error) return Response.json({ ok: false, error: 'Unable to record check-in. Please try again.' }, { status: 503 });
  const status = data?.ok ? 200 : data?.code === 'not_found' ? 404 : data?.code === 'forbidden' ? 403 : 409;
  return Response.json(data, { status });
}
