import { waitUntil } from '@vercel/functions';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { JAMIE_PROGRAM_ID, reconcileSeriesSales } from '@/lib/class-series-payments';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
let nextReconciliationAt = 0;
export async function GET() {
  const db = createAdminSupabaseClient();
  const { data: program, error } = await db.from('class_series_programs').select('class_ids,price_cents,second_child_discount_cents,due_at,payments_enabled').eq('id', JAMIE_PROGRAM_ID).maybeSingle();
  if (error || !program) return Response.json({ ok: true, payments_enabled: false, seats_available: null }, { headers: { 'cache-control': 'no-store' } });
  if (Date.now() >= nextReconciliationAt) {
    nextReconciliationAt = Date.now() + 30_000;
    waitUntil(reconcileSeriesSales(db));
  }
  const [{ data: sessions, error: classError }, { data: registrations, error: regError }] = await Promise.all([
    db.from('classes').select('id,capacity,status').in('id', program.class_ids),
    db.from('class_registrations').select('class_id').in('class_id', program.class_ids).in('status', ['scheduled', 'attended']),
  ]);
  if (classError || regError || sessions?.length !== program.class_ids.length || sessions.some(session => session.status !== 'scheduled' || session.capacity == null)) {
    return Response.json({ ok: true, payments_enabled: false, seats_available: null }, { headers: { 'cache-control': 'no-store' } });
  }
  const available = Math.max(0, Math.min(...sessions.map(session => session.capacity! - (registrations ?? []).filter(reg => reg.class_id === session.id).length)));
  return Response.json({ ok: true, payments_enabled: program.payments_enabled && Date.now() < Date.parse(program.due_at), seats_available: available, price_cents: program.price_cents, second_child_discount_cents: program.second_child_discount_cents, due_at: program.due_at }, { headers: { 'cache-control': 'no-store' } });
}
