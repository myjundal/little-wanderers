import { requireStaffContext } from '@/lib/authz';
import { isUuid } from '@/lib/open-play-reservations';
import { confirmFamilyPayment } from '@/lib/family-payment-confirmation';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export async function POST(req: Request) {
  const context = await requireStaffContext();
  if (!context.ok) return context.response;
  const body = await req.json().catch(() => null);
  if (!isUuid(String(body?.household_id ?? ''))) return Response.json({ ok: false, error: 'Choose a visiting family.' }, { status: 400 });
  try {
    const result = await confirmFamilyPayment(context.admin, body.household_id, context.user.id);
    return Response.json({ ok: true, ...result }, { headers: { 'cache-control': 'no-store' } });
  } catch {
    return Response.json({ ok: false, error: 'Unable to finish confirmation. Payment records are saved; do not charge again. Retry Payment confirmed.' }, { status: 503 });
  }
}
