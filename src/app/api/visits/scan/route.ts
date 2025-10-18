// src/app/api/visits/scan/route.ts
import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
  const { household_id, checkin_ids } = await req.json();

  if (!household_id || !Array.isArray(checkin_ids) || checkin_ids.length === 0) {
    return new Response('Missing household_id or checkin_ids', { status: 400 });
  }

  // 1) 미결제(‘open’) 방문 조회 또는 생성
  let { data: visit, error } = await supa
    .from('visits')
    .select('*')
    .eq('household_id', household_id)
    .eq('payment_status', 'open')
    .single();

  if (error && error.code === 'PGRST116') {
    // not found → 새 방문 생성
    const { data: newVisit, error: insertErr } = await supa
      .from('visits')
      .insert({ household_id })
      .select()
      .single();

    if (insertErr) {
      return new Response('Failed to create visit', { status: 500 });
    }
    visit = newVisit;
  } else if (error) {
    return new Response('Failed to query visit', { status: 500 });
  }

  // 2) 체크인 여러개에 visit_id 업데이트
  const { error: updateErr } = await supa
    .from('checkins')
    .update({ visit_id: visit.id })
    .in('id', checkin_ids);

  if (updateErr) {
    return new Response('Failed to update checkins', { status: 500 });
  }

  // 3) 체크인 라인아이템과 subtotal 계산
  const { data: items, error: itemsErr } = await supa
    .from('checkins')
    .select('id, service_cents')
    .eq('visit_id', visit.id);

  if (itemsErr) {
    return new Response('Failed to get checkin items', { status: 500 });
  }

  const subtotal_cents = items?.reduce((acc, i) => acc + (i.service_cents ?? 0), 0) ?? 0;

  // 4) visits 테이블 subtotal 업데이트
  const { error: updVisitErr } = await supa
    .from('visits')
    .update({ subtotal_cents, membership_count: items.length })
    .eq('id', visit.id);

  if (updVisitErr) {
    return new Response('Failed to update visit subtotal', { status: 500 });
  }

  return new Response(
    JSON.stringify({ visit_id: visit.id, items, subtotal_cents }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}

