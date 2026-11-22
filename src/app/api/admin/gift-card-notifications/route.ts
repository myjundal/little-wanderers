import { requireRevenueContext } from '@/lib/revenue-access';
import { enableGiftCardWebhooks, giftCardWebhookStatus, notifyGiftCardPayment } from '@/lib/gift-card-notifications';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;
const headers = { 'Cache-Control': 'private, no-store', Vary: 'Cookie' };

export async function GET() {
  const context = await requireRevenueContext();
  if (!context.ok) return context.response;
  try { return Response.json({ ok: true, status: await giftCardWebhookStatus() }, { headers }); }
  catch { return Response.json({ ok: false, error: 'Unable to verify Square gift card webhook configuration.' }, { status: 503, headers }); }
}

/** Personal owner only: preserve the existing subscription/key and optionally
 * replay a real, completed receipt. This endpoint never takes a payment. */
export async function POST(req: Request) {
  const context = await requireRevenueContext();
  if (!context.ok) return context.response;
  if (req.headers.get('origin') !== new URL(req.url).origin) return Response.json({ ok: false, error: 'Forbidden.' }, { status: 403, headers });
  if (process.env.VERCEL_ENV !== 'production') return Response.json({ ok: false, error: 'Production only.' }, { status: 409, headers });
  const input = await req.json().catch(() => null);
  try {
    if (input?.action === 'enable') return Response.json({ ok: true, status: await enableGiftCardWebhooks() }, { headers });
    if (input?.action === 'replay' && typeof input.payment_id === 'string' && /^[A-Za-z0-9_-]{8,100}$/.test(input.payment_id)) {
      return Response.json({ ok: true, result: await notifyGiftCardPayment(context.admin, input.payment_id), charges_executed: false }, { headers });
    }
    return Response.json({ ok: false, error: 'Invalid action.' }, { status: 400, headers });
  } catch { return Response.json({ ok: false, error: 'Gift card notification setup or delivery pending.' }, { status: 503, headers }); }
}
