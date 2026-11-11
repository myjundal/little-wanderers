import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { verifyPosReturnState } from '@/lib/square-pos-return-token';
import { verifyAdmissionPos, reconcileAdmissionPos, type PosSale } from '@/lib/square-admission-pos';
import { squareConfig } from '@/lib/square-client';
export const maxDuration = 60;

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'private, no-store' } });
export async function POST(req: Request) {
  const origin = req.headers.get('origin');
  if ((origin && origin !== new URL(req.url).origin) || req.headers.get('sec-fetch-site') === 'cross-site') return json({ ok: false }, 403);
  try {
    const text = await req.text();
    if (text.length > 1000) return json({ ok: false }, 400);
    const body = JSON.parse(text);
    const saleId = verifyPosReturnState(body.state);
    if (!saleId || typeof body.transaction_id !== 'string' || !body.transaction_id || body.transaction_id.length > 200) return json({ ok: false }, 400);
    const admin = createAdminSupabaseClient(), config = squareConfig();
    const { data: raw, error } = await admin.from('admission_pos_sales').select('*').eq('id', saleId).eq('environment', config.environment).eq('location_id', config.locationId).maybeSingle();
    if (error || !raw || !raw.launched_at) return json({ ok: false }, 409);
    const sale = raw as PosSale;
    if (sale.status === 'paid') return json({ ok: true, status: 'paid' });
    if (sale.status !== 'open') return json({ ok: true, status: 'pending' });
    let result;
    try { result = await verifyAdmissionPos(admin, sale, body.transaction_id); }
    catch { result = await reconcileAdmissionPos(admin, sale); }
    // No family details, staff session, cancellation or new payment is exposed.
    return json({ ok: true, status: result.status === 'paid' ? 'paid' : 'pending' });
  } catch { return json({ ok: false, status: 'pending' }, 503); }
}
