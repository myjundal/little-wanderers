import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { readClassCancellation, chooseClassCancellation } from '@/lib/class-cancellations';
import { isSameOriginRequest } from '@/lib/request-origin';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const headers = { 'cache-control': 'private, no-store', 'referrer-policy': 'no-referrer' };
const publicNotice = (n: Awaited<ReturnType<typeof readClassCancellation>>['notice']) => ({ title: n.title, start_time: n.start_time, target_start_time: n.target_start_time, amount_cents: n.amount_cents, state: n.state });
export async function GET(req: Request) {
  try { const { notice } = await readClassCancellation(createAdminSupabaseClient(), new URL(req.url).searchParams.get('token')); return Response.json({ ok: true, notice: publicNotice(notice) }, { headers }); }
  catch { return Response.json({ ok: false, error: 'This class options link is invalid. Please reply to your cancellation email for help.' }, { status: 404, headers }); }
}
export async function POST(req: Request) {
  if (process.env.VERCEL_ENV === 'preview') return Response.json({ ok: false, error: 'Please use the link in your cancellation email.' }, { status: 409, headers });
  if (!isSameOriginRequest(req)) return Response.json({ ok: false, error: 'Invalid request origin.' }, { status: 403, headers });
  try { const body = await req.json(); const notice = await chooseClassCancellation(createAdminSupabaseClient(), body.token, body.choice); return Response.json({ ok: true, notice: publicNotice(notice) }, { headers }); }
  catch (e) { console.error('class_cancellation_choice_failed', e instanceof Error ? e.message : 'Selection failed'); return Response.json({ ok: false, error: e instanceof Error && /^(Choose |Your |Next week|There is no|Please finish)/.test(e.message) ? e.message : 'We could not complete your selection yet. Please retry the same option or reply to your cancellation email for help. You will not be charged again.' }, { status: 409, headers }); }
}
