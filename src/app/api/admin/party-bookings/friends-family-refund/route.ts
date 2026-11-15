import { requireRevenueContext } from '@/lib/revenue-access';
import { isSameOriginRequest } from '@/lib/request-origin';
import { isUuid } from '@/lib/open-play-reservations';
import { previewPartyDiscountRefund, refundPartyDiscount } from '@/lib/party-discount-refund';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const headers = { 'Cache-Control': 'private, no-store', Vary: 'Cookie' };
export async function POST(req: Request) {
  const context = await requireRevenueContext();
  if (!context.ok) return context.response;
  if (!isSameOriginRequest(req)) return Response.json({ ok: false, error: 'Invalid request origin.' }, { status: 403, headers });
  const body = await req.json().catch(() => null);
  if (!isUuid(String(body?.party_id ?? '')) || ![body?.order_id, body?.payment_id].every(value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value))
    || !Number.isSafeInteger(body?.expected_payment_cents) || !['preview', 'refund'].includes(body?.action)) return Response.json({ ok: false, error: 'Choose a verified party payment.' }, { status: 400, headers });
  if (body.action === 'refund' && (body.confirmation !== 'REFUND PARTY FRIENDS FAMILY 50' || body.refund_cents !== 5000)) return Response.json({ ok: false, error: 'Confirm the USD 50 party discount refund.' }, { status: 400, headers });
  const input = { partyId: body.party_id, orderId: body.order_id, paymentId: body.payment_id, expectedPaymentCents: body.expected_payment_cents };
  try {
    if (body.action === 'preview') {
      const prepared = await previewPartyDiscountRefund(context.admin, input);
      return Response.json({ ok: true, amount_cents: prepared.amount_cents, payment_id: prepared.payment.id,
        existing_refund: prepared.existing ? { id: prepared.existing.id, status: prepared.existing.status } : null }, { headers });
    }
    return Response.json({ ok: true, ...await refundPartyDiscount(context.admin, input) }, { headers });
  } catch {
    return Response.json({ ok: false, error: 'Unable to verify this party refund. Check its provider status before retrying.' }, { status: 409, headers });
  }
}
