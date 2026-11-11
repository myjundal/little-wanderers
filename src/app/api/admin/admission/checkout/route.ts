import { requireStaffContext } from '@/lib/authz';
import { isUuid } from '@/lib/open-play-reservations';
import { checkoutAdmission } from '@/lib/admission-checkout';

export const dynamic = 'force-dynamic';
const headers = { 'cache-control': 'no-store' };

export async function POST(req: Request) {
  const context = await requireStaffContext();
  if (!context.ok) return context.response;
  const body = await req.json().catch(() => null);
  const ids: unknown = body?.checkin_ids;
  if (!isUuid(String(body?.household_id ?? '')) || !Array.isArray(ids) || !ids.length || ids.length > 100
    || ids.some(id => typeof id !== 'string' || !isUuid(id)) || new Set(ids).size !== ids.length) {
    return Response.json({ ok: false, error: 'Choose one visiting family to check out.' }, { status: 400, headers });
  }
  try {
    const result = await checkoutAdmission(context.admin, ids as string[], body.household_id, context.user.id);
    return Response.json({ ok: true, ...result }, { headers });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : 'Unable to check out family.' }, { status: 409, headers });
  }
}
