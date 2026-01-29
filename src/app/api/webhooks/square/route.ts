// ./src/app/api/webhooks/square/route.ts
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const SUPA = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

// Support both sha1/sha256
function verifySignature(rawBody: string, signature: string | null, algo: 'sha1'|'sha256') {
  const key = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;
  if (!key || !signature) return false;
  const hmac = crypto.createHmac(algo, key).update(rawBody, 'utf8').digest('base64');
  try {
    return crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(signature));
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  // Read raw body FIRST (signature is over raw text)
  const raw = await req.text();

  const isProd = process.env.NODE_ENV === 'production';
  // Optional: temporarily allow without signature during local tests
  const sigOk = signature ? verifySignature(raw, signature) : !isProd;
  if (!sigOk) return new Response('invalid signature', { status: 401 });

  const payload = JSON.parse(raw);
  const supa = SUPA();

  // -------- idempotency guard --------
  const eventId: string | null =
    payload?.event_id ?? payload?.id ?? payload?.data?.id ?? null;

  if (eventId) {
    try {
      await supa.from('webhook_log').insert({
        provider: 'square',
        event_id: eventId,
        payload,
      });
    } catch (e: any) {
      // duplicate key → already processed
      if ((e?.message || '').toLowerCase().includes('duplicate')) {
        return new Response('duplicate', { status: 200 });
      }
      // if PostgREST error
      const errStr = typeof e === 'string' ? e : e?.message || 'insert error';
      return new Response(errStr, { status: 500 });
    }
  } else {
    // no event id → still log without unique guard
    await supa.from('webhook_log').insert({
      provider: 'square',
      payload,
    });
  }

  // -------- route events --------
  const type: string = payload?.type ?? payload?.event_type ?? '';
  const sub = payload?.data?.object?.subscription ?? null;
  const payment = payload?.data?.object?.payment ?? null;
  const customerId: string | null =
    payload?.data?.object?.customer?.id ??
    sub?.customer_id ??
    null;

  const subscription = payload?.data?.object?.subscription;
  const subscriptionStatus: string | undefined = subscription?.status;
  const renewsAt: string | undefined =
    subscription?.charged_through_date ?? subscription?.next_billing_date;

  const statusMap = (status?: string) => {
    if (!status) return 'paused';
    if (status === 'ACTIVE') return 'active';
    if (status === 'CANCELED' || status === 'DEACTIVATED') return 'canceled';
    if (status === 'PAUSED') return 'paused';
    return 'paused';
  };

  // Membership activation example (subscription updated/canceled)
  if (type.includes('subscription.updated') || type.includes('subscription.canceled')) {

    if (customerId) {
      // Find household by your chosen mapping (e.g., pre-saved square_customer_id on memberships)
      // Here we upsert a household-level membership. Adjust if you map per-person.
      await supa
        .from('memberships')
        .upsert(
          {
            square_customer_id: customerId,
            square_subscription_id: payload?.data?.object?.subscription?.id ?? null,
            status: statusMap(subscriptionStatus),
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
      const payment = payload?.data?.object?.payment;
      const order = payload?.data?.object?.order ?? payment?.order;
      const lineItems = order?.line_items ?? [];
      const totalMoney = payment?.amount_money?.amount ?? null;
      console.info('Square payment completed', {
        paymentId: payment?.id ?? null,
        totalMoney,
        lineItemsCount: lineItems.length
      });
    }
  }

  // ---- subscription updates → membership status upsert (household-level) ----
  if (type.includes('subscription.updated') && householdId) {
    const sqStatus: string | undefined = sub?.status;
    const renewsAt: string | undefined = sub?.charged_through_date;

    const status =
      sqStatus === 'ACTIVE' ? 'active' :
      sqStatus === 'CANCELED' ? 'canceled' :
      'paused';

    await supa.from('memberships').upsert(
      {
        household_id: householdId,
        status,
        renews_at: renewsAt ? new Date(renewsAt).toISOString() : null,
      },
      { onConflict: 'household_id' }
    );
  }

  // ---- one-time payment completed → passes issue (stub) ----
  if (type.includes('payment.updated') && payment?.status === 'COMPLETED' && householdId) {
    // TODO:
    // - read order line items from payload?.data?.object?.order_id (you may need to fetch order by id)
    // - if item is '5-Pack', increment passes for household
  }

  return new Response('ok', { status: 200 });
}
