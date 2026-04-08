// src/app/api/checkout/subscribe/route.ts
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getLatestHouseholdIdForUser } from '@/lib/households';
import crypto from 'crypto';
import { buildPrePopulatedData, logSquarePayload } from '@/lib/square';
import { logger } from '@/lib/logger';

const SQUARE_BASE = 'https://connect.squareupsandbox.com';

export async function GET() {
  return NextResponse.json({ ok: true, where: '/api/checkout/subscribe' });
}

export async function POST() {
  try {
    const supabase = createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      logger.warn({ action: 'auth.subscribe_checkout_unauthorized' });
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    logger.info({ action: 'auth.subscribe_checkout_user_authenticated', userId: user.id });

    const householdId = await getLatestHouseholdIdForUser(supabase, user.id);
    if (!householdId) {
      logger.warn({ action: 'membership.household_missing_for_checkout', userId: user.id });
      return NextResponse.json({ error: 'no household' }, { status: 400 });
    }

    const idempotencyKey = crypto.randomUUID();
    const base = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';

    const body = {
      idempotency_key: idempotencyKey,
      quick_pay: {
        name: 'Little Wanderers Monthly Membership',
        price_money: {
          amount: 6000,
          currency: 'USD',
        },
        location_id: process.env.SQUARE_LOCATION_ID!,
      },
      checkout_options: {
        subscription_plan_id: process.env.SQUARE_PLAN_VARIATION_ID!,
        redirect_url: `${base}/landing/membership?success=1`,
        ask_for_shipping_address: false,
      },
      ...(buildPrePopulatedData(user.email) ? { pre_populated_data: buildPrePopulatedData(user.email) } : {}),
      reference_id: `hh_${householdId}`,
    };

    logSquarePayload('membership checkout payload', body as Record<string, unknown>, { userId: user.id, householdId });

    const resp = await fetch(`${SQUARE_BASE}/v2/online-checkout/payment-links`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.SQUARE_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
        'Square-Version': '2025-10-16',
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const text = await resp.text();
      logger.error({ action: 'square.checkout_create_payment_link_failed', userId: user.id, householdId, status: resp.status }, new Error('Square CreatePaymentLink request failed'));
      return NextResponse.json({ error: 'square_error', detail: text }, { status: 500 });
    }

    const data = await resp.json();
    const url: string | undefined = data?.payment_link?.url;

    if (!url) {
      logger.error({ action: 'square.checkout_missing_url', userId: user.id, householdId });
      return NextResponse.json({ error: 'no_url_returned' }, { status: 500 });
    }

    logger.info({ action: 'square.checkout_link_created', userId: user.id, householdId });
    return NextResponse.json({ url });
  } catch (error) {
    logger.error({ action: 'square.checkout_unexpected_error' }, error);
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }
}
