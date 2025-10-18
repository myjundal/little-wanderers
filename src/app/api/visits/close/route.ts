// src/app/api/visits/close/route.ts
import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
  const { visit_id, payment_method, payment_ref } = await req.json();

  if (!visit_id || !payment_method) {
    return new Response('Missing visit_id or payment_method', { status: 400 });
  }

  const { error } = await supa
    .from('visits')
    .update({
      payment_status: 'paid',
      payment_method,
      payment_ref,
      closed_at: new Date().toISOString(),
    })
    .eq('id', visit_id);

  if (error) {
    return new Response('Failed to close visit', { status: 500 });
  }

  return new Response('Visit closed', { status: 200 });
}

