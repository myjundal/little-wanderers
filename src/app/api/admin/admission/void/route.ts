import { requireStaffContext } from '@/lib/authz';
import { isSameOriginRequest } from '@/lib/request-origin';
import { isUuid } from '@/lib/open-play-reservations';
import { squareEnvironment } from '@/lib/square-client';
export const dynamic = 'force-dynamic';
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
export async function POST(req: Request) {
  const context = await requireStaffContext();
  if (!context.ok) return context.response;
  if (!isSameOriginRequest(req) || req.headers.get('sec-fetch-site') === 'cross-site') return json({ ok: false, error: 'Please use the staff check-in page.' }, 403);
  const body = await req.json().catch(() => null);
  if (!body || !isUuid(body.request_id ?? '') || !isUuid(body.household_id ?? '') || !Array.isArray(body.checkin_ids)
    || body.checkin_ids.length < 1 || body.checkin_ids.length > 30 || body.checkin_ids.some((id: unknown) => typeof id !== 'string' || !isUuid(id))
    || new Set(body.checkin_ids).size !== body.checkin_ids.length || !Number.isSafeInteger(body.expected_total_cents) || body.expected_total_cents <= 0
    || typeof body.reason !== 'string' || body.reason.trim().length < 5 || body.reason.length > 500) return json({ ok: false, error: 'Choose the family’s unpaid admission and a reason.' }, 400);
  try {
    const result = await context.admin.rpc('void_admission_payment', { p_id: body.request_id, p_actor: context.user.id, p_family: body.household_id,
      p_ids: body.checkin_ids, p_environment: squareEnvironment(), p_reason: body.reason.trim(), p_expected_total: body.expected_total_cents });
    if (result.error) {
      if (['PGRST202', '42P01', '42883'].includes(result.error.code ?? '')) return json({ ok: false, error: 'Void payment is awaiting database setup. The check-in is saved.' }, 503);
      return json({ ok: false, error: result.error.code === 'P0001' ? result.error.message : 'Unable to void payment. Refresh admission status before retrying.' }, 409);
    }
    return json({ ok: true, ...result.data });
  } catch { return json({ ok: false, error: 'Unable to confirm the void. Refresh this family before retrying.' }, 503); }
}
