import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
const NO_STORE_HEADERS = { 'cache-control': 'no-store, max-age=0' };

const admin = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

function isMissingColumnError(message: string) {
  return /column .* does not exist|Could not find the '.*' column/i.test(message);
}

export async function GET() {
  try {
    const supa = admin();
    const primary = await supa
      .from('party_bookings')
      .select('id,start_time,end_time,status')
      .gte('start_time', new Date().toISOString())
      .neq('status', 'cancelled')
      .order('start_time', { ascending: true });

    if (!primary.error) return Response.json({ ok: true, items: primary.data ?? [] }, { headers: NO_STORE_HEADERS });
    if (!isMissingColumnError(primary.error.message)) return Response.json({ ok: false, error: primary.error.message }, { status: 500, headers: NO_STORE_HEADERS });

    const fallback = await supa
      .from('party_bookings')
      .select('id,start_time,end_time')
      .gte('start_time', new Date().toISOString())
      .order('start_time', { ascending: true });

    if (fallback.error) return Response.json({ ok: false, error: fallback.error.message }, { status: 500, headers: NO_STORE_HEADERS });
    return Response.json({ ok: true, items: fallback.data ?? [] }, { headers: NO_STORE_HEADERS });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'unknown error';
    return Response.json({ ok: false, error: message }, { status: 500, headers: NO_STORE_HEADERS });
  }
}
