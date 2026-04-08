// src/app/api/checkout/subscribe/route.ts
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getLatestHouseholdIdForUser } from '@/lib/households';
import crypto from 'crypto';

const SQUARE_BASE = 'https://connect.squareupsandbox.com';

export async function GET() {
  return NextResponse.json({ ok: true, where: '/api/checkout/subscribe' });
}

export async function POST(req: Request) {
  try {
    const supabase = createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    // 1) Resolve latest household membership for this user
    const householdId = await getLatestHouseholdIdForUser(supabase, user.id);
    if (!householdId) {
      return NextResponse.json({ error: 'no household' }, { status: 400 });
    }

    // 2) Build Square Checkout (subscription plan checkout)
    const idempotencyKey = crypto.randomUUID();
    const base = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';

    const body = {
      idempotency_key: idempotencyKey,
      // Quick Pay section: initial phase price & name shown on checkout
      quick_pay: {
        name: 'Little Wanderers Monthly Membership',
        price_money: {
          // Amount must match the variation initial phase price to avoid overrides.
          amount: 6000,
          currency: 'USD',
        },
        location_id: process.env.SQUARE_LOCATION_ID!,
      },
      checkout_options: {
        // Important: this field must use the plan variation ID.
        subscription_plan_id: process.env.SQUARE_PLAN_VARIATION_ID!,
        redirect_url: `${base}/landing/membership?success=1`,
        ask_for_shipping_address: false,
      },
      // Optional: pre-filled buyer info
      pre_populated_data: {
        buyer_email: user.email ?? undefined,
      },
      // Optional: internal reference to help webhook reconciliation
      reference_id: `hh_${householdId}`,
    };

    const resp = await fetch(`${SQUARE_BASE}/v2/online-checkout/payment-links`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.SQUARE_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
        // Use a recent Square API version.
        'Square-Version': '2025-10-16',
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const text = await resp.text();
      console.error('Square CreatePaymentLink error', resp.status, text);
      return NextResponse.json({ error: 'square_error', detail: text }, { status: 500 });
    }

    const data = await resp.json();
    const url: string | undefined = data?.payment_link?.url;

    if (!url) {
      return NextResponse.json({ error: 'no_url_returned' }, { status: 500 });
    }

    // 3) Return hosted checkout URL to client
    return NextResponse.json({ url });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }
}
