import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const SUPA = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

// TODO: adapt if Square header name differs for your environment.
function verifySignature(rawBody: string, signature: string | null) {
  if (!process.env.SQUARE_WEBHOOK_SIGNATURE_KEY) return false;
  if (!signature) return false;
  const hmac = crypto
    .createHmac('sha1', process.env.SQUARE_WEBHOOK_SIGNATURE_KEY)
    .update(rawBody, 'utf8')
    .digest('base64');
  return crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(signature));
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const signature = req.headers.get('x-square-hmacsha1-signature');

  // Optional: temporarily allow without signature during local tests
  const sigOk = signature ? verifySignature(raw, signature) : true;
  if (!sigOk) return new Response('invalid signature', { status: 401 });

  const payload = JSON.parse(raw);
  const supa = SUPA();

  // Always log the raw webhook (for debugging)
  await supa.from('webhook_log').insert({
    provider: 'square',
    payload
  });

  // Handle events
  const type: string = payload?.type ?? payload?.event_type ?? '';
  // Normalize customer email/phone if provided
  const customerId: string | null =
    payload?.data?.object?.customer?.id ??
    payload?.data?.object?.subscription?.customer_id ??
    null;

  // Membership activation example (subscription updated -> ACTIVE)
  if (type.includes('subscription.updated')) {
    const status: string | undefined = payload?.data?.object?.subscription?.status;
    const renewsAt: string | undefined = 
payload?.data?.object?.subscription?.charged_through_date;

    if (customerId) {
      // Find household by your chosen mapping (e.g., pre-saved square_customer_id on memberships)
      // Here we upsert a household-level membership. Adjust if you map per-person.
      await supa
        .from('memberships')
        .upsert(
          {
            square_customer_id: customerId,
            square_subscription_id: payload?.data?.object?.subscription?.id ?? null,
            status: status === 'ACTIVE' ? 'active' : status === 'CANCELED' ? 'canceled' : 
'paused',
            renews_at: renewsAt ? new Date(renewsAt).toISOString() : null
          },
          { onConflict: 'square_subscription_id' }
        );
    }
  }

  // One-time purchases -> passes upsert (payment.updated COMPLETED)
  if (type.includes('payment.updated')) {
    const status: string | undefined = payload?.data?.object?.payment?.status; // 'COMPLETED'
    if (status === 'COMPLETED') {
      // TODO: parse line items from `order` -> if '5-Pack' -> insert/augment passes
      // await supa.from('passes').insert(...);
    }
  }

  return new Response('ok', { status: 200 });
}

