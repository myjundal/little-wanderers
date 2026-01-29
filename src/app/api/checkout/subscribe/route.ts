// src/app/api/checkout/subscribe/route.ts
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
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

    // 1) Resolve latest household for this user
    const { data: households } = await supabase
      .from('households')
      .select('id')
      .eq('owner_user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1);

    const householdId = households?.[0]?.id ?? null;
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
          // 금액은 반드시 variation 의 initial phase 가격과 일치해야 함 (다르면 override로 동작)
          amount: 6000,
          currency: 'USD',
        },
        location_id: process.env.SQUARE_LOCATION_ID!,
      },
      checkout_options: {
        // 중요: 여기 "subscription_plan_id" 필드에는 **플랜 variation ID** 를 넣습니다.
        subscription_plan_id: process.env.SQUARE_PLAN_VARIATION_ID!,
        redirect_url: `${base}/landing/membership?success=1`,
        ask_for_shipping_address: false,
      },
      // 선택: 사전 입력 데이터
      pre_populated_data: {
        buyer_email: user.email ?? undefined,
      },
      // 선택: 내부 식별자(웹훅에서 역참조에 도움)
      reference_id: `hh_${householdId}`,
    };

    const resp = await fetch(`${SQUARE_BASE}/v2/online-checkout/payment-links`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.SQUARE_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
        // 최신 버전 사용. (Sandbox에서 2023-06-08 이후 구독 결제링크 지원)
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

