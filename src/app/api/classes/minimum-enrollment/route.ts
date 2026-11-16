import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { authorizeClassCancellationTrigger, runClassMinimumCancellations } from '@/lib/class-cancellations';
import { validCheckoutId } from '@/lib/class-checkout';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export async function POST(req: Request) {
  const headers = { 'cache-control': 'private, no-store' };
  if (!authorizeClassCancellationTrigger(req)) return Response.json({ ok: false, error: 'unauthorized' }, { status: 401, headers });
  if (process.env.VERCEL_ENV !== 'production') return Response.json({ ok: false, error: 'Production only.' }, { status: 409, headers });
  const body = await req.json().catch(() => null);
  if (typeof body?.dry_run !== 'boolean' || (body.class_id && !validCheckoutId(body.class_id))) return Response.json({ ok: false, error: 'Specify dry_run and an optional class_id.' }, { status: 400, headers });
  try { return Response.json(await runClassMinimumCancellations(createAdminSupabaseClient(), { dryRun: body.dry_run, classId: body.class_id }), { headers }); }
  catch (e) { console.error('class_minimum_failed', e instanceof Error ? e.message : 'Class minimum failed'); return Response.json({ ok: false, error: 'Class cancellation job needs review.' }, { status: 500, headers }); }
}
