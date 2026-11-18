import { requireRevenueContext } from '@/lib/revenue-access';
import { isSameOriginRequest } from '@/lib/request-origin';
import { isUuid } from '@/lib/open-play-reservations';
import { previewAdmissionMembershipRefund, refundAdmissionMembership } from '@/lib/admission-membership-refund';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const headers = { 'Cache-Control': 'private, no-store', Vary: 'Cookie' };
export async function POST(req: Request) {
  const context = await requireRevenueContext();
  if (!context.ok) return context.response;
  if (!isSameOriginRequest(req)) return Response.json({ ok: false, error: 'Invalid request origin.' }, { status: 403, headers });
  const body = await req.json().catch(() => null);
  if (!isUuid(String(body?.household_id ?? '')) || typeof body?.order_id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(body.order_id) || !Number.isSafeInteger(body?.expected_amount_cents) || body.expected_amount_cents <= 0 || !['preview', 'refund'].includes(body?.action)) return Response.json({ ok: false, error: 'Choose a verified admission payment.' }, { status: 400, headers });
  if (body.action === 'refund' && body.confirmation !== 'REFUND ORIGINAL ADMISSION PAYMENT') return Response.json({ ok: false, error: 'Confirm the full original-card admission refund.' }, { status: 400, headers });
  const input = { householdId: body.household_id, orderId: body.order_id, expectedAmountCents: body.expected_amount_cents };
  try {
    if (body.action === 'preview') {
      const prepared = await previewAdmissionMembershipRefund(context.admin, input);
      return Response.json({ ok: true, amount_cents: prepared.amount_cents, payment_id: prepared.payment.id, existing_refund: prepared.existing ? { id: prepared.existing.id, status: prepared.existing.status } : null }, { headers });
    }
    return Response.json({ ok: true, ...await refundAdmissionMembership(context.admin, input) }, { headers });
  } catch {
    return Response.json({ ok: false, error: 'Unable to verify this admission refund. Check provider status before retrying.' }, { status: 409, headers });
  }
}
