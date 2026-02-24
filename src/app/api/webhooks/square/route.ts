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

  // Signature header names can differ by Square env
  const sigSha1 = req.headers.get('x-square-hmacsha1-signature');
  const sigSha256 = req.headers.get('x-square-hmacsha256-signature');
  const allowUnsigned = process.env.NODE_ENV !== 'production'; // local only

  const sigOk =
    (sigSha256 && verifySignature(raw, sigSha256, 'sha256')) ||
    (sigSha1 && verifySignature(raw, sigSha1, 'sha1')) ||
    allowUnsigned;

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
        .limit(1) as any;

      const userId = users?.[0]?.id ?? null;
      if (userId) {
        const { data: hh } = await supa
          .from('households')
          .select('id')
          .eq('owner_user_id', userId)
          .order('created_at', { ascending: false })
          .limit(1);
        householdId = hh?.[0]?.id ?? null;
      }
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

