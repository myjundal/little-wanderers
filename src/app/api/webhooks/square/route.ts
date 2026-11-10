// ./src/app/api/webhooks/square/route.ts
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifySquareWebhook } from '@/lib/square-webhook';
import { verifyOpenPlayPayment, type OpenPlayPayment } from '@/lib/soft-opening-payments';
import { verifySeriesPayment, type SeriesSale } from '@/lib/class-series-payments';
import { squareEnvironment } from '@/lib/square-client';
import { getLatestHouseholdIdForUser } from '@/lib/households';
import { syncFoundingSubscription } from '@/lib/founding-square';
import { waitUntil } from '@vercel/functions';
import { sendDueMembershipNotifications } from '@/lib/membership-notifications';

const SUPA = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

export async function POST(req: NextRequest) {
  // Read raw body FIRST (signature is over raw text)
  const raw = await req.text();

  const notificationUrl = process.env.SQUARE_WEBHOOK_URL?.trim() || req.url;
  const sigOk = verifySquareWebhook(raw, req.headers.get('x-square-hmacsha256-signature'), process.env.SQUARE_WEBHOOK_SIGNATURE_KEY, notificationUrl);
  if (!sigOk) return new Response('invalid signature', { status: 401 });

  let payload;
  try { payload = JSON.parse(raw); } catch { return new Response('invalid JSON', { status: 400 }); }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return new Response('invalid event', { status: 400 });
  const supa = SUPA();

  // Reconcile founding subscriptions before the legacy receipt log. A database failure
  // must remain retryable, and provider state makes duplicate/out-of-order events safe.
  const foundingSubscriptionId = payload?.data?.object?.subscription?.id ?? payload?.data?.object?.invoice?.subscription_id;
  if (typeof foundingSubscriptionId === 'string') {
    try {
      if (await syncFoundingSubscription(supa, foundingSubscriptionId)) return new Response('ok', { status: 200 });
    } catch { return new Response('membership reconciliation pending', { status: 503 }); }
  }

  const eventType = payload?.type ?? '';
  if (['payment.created', 'payment.updated', 'invoice.payment_made'].includes(eventType)) {
    const eventOrder = payload?.data?.object?.payment?.order_id ?? payload?.data?.object?.invoice?.order_id;
    if (eventOrder) {
      const {data: visit, error: visitError} = await supa.from('open_play_reservations').select('*').eq('payment_environment',squareEnvironment()).eq('square_order_id',eventOrder).maybeSingle();
      if (visitError) return new Response('Reservation payment lookup pending',{status:503});
      if (visit) { try { await verifyOpenPlayPayment(supa,visit as OpenPlayPayment); return new Response('Reservation payment verified',{status:200}); } catch { return new Response('Reservation payment verification pending',{status:503}); } }

      const { data: classSale, error: classSaleError } = await supa.from('class_series_sales').select('*').eq('environment', squareEnvironment()).eq('square_order_id', eventOrder).maybeSingle();
      if (classSaleError) return new Response('Unable to find class payment', { status: 500 });
      if (classSale) {
        try {
          await verifySeriesPayment(supa, classSale as SeriesSale);
          return new Response('class payment verified', { status: 200 });
        } catch { return new Response('Class payment verification pending', { status: 500 }); }
      }
    }
  }

  // -------- idempotency guard --------
  const eventId: string | null =
    payload?.event_id ?? payload?.id ?? payload?.data?.id ?? null;

  if (eventId) {
    const { error: logError } = await supa.from('webhook_log').insert({
      provider: 'square',
      event_id: eventId,
      payload,
    });

    if (logError) {
      if (logError.code === '23505' || logError.message.toLowerCase().includes('duplicate')) {
        return new Response('duplicate', { status: 200 });
      }

      return new Response(logError.message, { status: 500 });
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

  // resolve household via square_customers mapping
  let householdId: string | null = null;
  if (customerId) {
    const { data: mapRows, error: mapErr } = await supa
      .from('square_customers')
      .select('household_id')
      .eq('square_customer_id', customerId)
      .limit(1);

    if (!mapErr && mapRows && mapRows.length > 0) {
      householdId = mapRows[0].household_id;
    }
  }

  // If we still don't know household, try a best-effort email match (optional fallback)
  if (!householdId) {
    const email: string | undefined =
      payload?.data?.object?.customer?.email_address ??
      payload?.data?.object?.buyer_email_address ??
      undefined;
    if (email) {
      // find user by email, then their latest household
      const { data: users } = await supa
        .from('auth.users') /* only works with service role + PG schema exposed */
        .select('id')
        .ilike('email', email)
        .limit(1);

      const userId = users?.[0]?.id ?? null;
      if (userId) {
        householdId = await getLatestHouseholdIdForUser(supa, userId);
      }
    }
  }

  // ---- subscription updates → household-level membership upsert ----
  if (type.includes('subscription.updated') && householdId) {
    const renewsAt: string | undefined = sub?.charged_through_date;

    await supa.from('memberships').upsert(
      {
        household_id: householdId,
        square_subscription_id: sub?.id ?? null,
        square_environment: squareEnvironment(),
        renews_at: renewsAt ? new Date(renewsAt).toISOString() : null,
      },
      { onConflict: 'household_id' }
    );
    waitUntil(sendDueMembershipNotifications(supa).catch(() => null));
  }

  // ---- one-time payment completed → passes issue (stub) ----
  if (type.includes('payment.updated') && payment?.status === 'COMPLETED' && householdId) {
    // TODO:
    // - read order line items from payload?.data?.object?.order_id (you may need to fetch order by id)
    // - if item is '5-Pack', increment passes for household
  }

  return new Response('ok', { status: 200 });
}
