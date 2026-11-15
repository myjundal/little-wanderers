import { requireOwnerContext } from '@/lib/authz';
import { validCheckoutId } from '@/lib/class-checkout';
import { isSameOriginRequest } from '@/lib/request-origin';
import { previewBalletSiblingRefund, refundBalletSibling } from '@/lib/ballet-sibling-refund';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export async function POST(req: Request) {
  const context = await requireOwnerContext();
  if (!context.ok) return context.response;
  if (!isSameOriginRequest(req)) return Response.json({ ok: false, error: 'Invalid request origin.' }, { status: 403 });
  const body = await req.json().catch(() => null);
  if (![body?.household_id, body?.class_id, body?.person_id].every(validCheckoutId)) return Response.json({ ok: false, error: 'Choose a valid family, ballet date and child.' }, { status: 400 });
  const input = { householdId: body.household_id, classId: body.class_id, personId: body.person_id };
  try {
    if (body.action === 'preview') {
      const quote = await previewBalletSiblingRefund(context.admin, input);
      return Response.json({ ok: true, amount_cents: quote.amountCents, payment_id: quote.payment.id, existing_refund: quote.existing ? { id: quote.existing.id, status: quote.existing.status } : null }, { headers: { 'cache-control': 'no-store' } });
    }
    if (body.action !== 'refund' || body.confirmation !== 'REFUND BALLET SIBLING DISCOUNT' || !Number.isSafeInteger(body.expected_amount_cents)) return Response.json({ ok: false, error: 'Review and confirm the sibling refund amount.' }, { status: 400 });
    return Response.json({ ok: true, ...await refundBalletSibling(context.admin, { ...input, expectedAmountCents: body.expected_amount_cents, ownerId: context.user.id }) }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    console.error('ballet_sibling_refund_failed', error instanceof Error ? error.message : 'Verification failed');
    return Response.json({ ok: false, error: 'Unable to verify this refund. Review the payment before retrying.' }, { status: 409 });
  }
}
