import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { authorizeMembershipNoticeTrigger } from '@/lib/membership-billing-notice-auth';
import { runMembershipBillingNotices } from '@/lib/membership-billing-notice-runner.mjs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;
const headers = { 'cache-control': 'private, no-store' };

export async function POST(req: Request) {
  if (!authorizeMembershipNoticeTrigger(req)) return Response.json({ ok: false, error: 'unauthorized' }, { status: 401, headers });
  const input = await req.json().catch(() => null);
  if (!input || typeof input.dry_run !== 'boolean') return Response.json({ ok: false, error: 'Specify dry_run.' }, { status: 400, headers });
  if (process.env.VERCEL_ENV !== 'production') return Response.json({ ok: false, error: 'Production only.' }, { status: 409, headers });
  try {
    const result = await runMembershipBillingNotices({ db: createAdminSupabaseClient(), mode: input.dry_run ? 'preview' : 'send_due' });
    const count = (status: string) => result.results.filter((row: { status?: string }) => row.status === status).length;
    const failures = count('error') + count('retry');
    // Workflow logs are public on public repositories: return counts, never contacts or bodies.
    return Response.json({ ok: failures === 0, dry_run: input.dry_run, checked_at: result.checked_at, eligible: result.results.length, sent: count('sent'), already_sent: count('already_sent'), in_progress: count('in_progress'), review: result.review.length + count('review'), failures, pending: result.pending, charges_executed: false }, { status: failures ? 503 : 200, headers });
  } catch { return Response.json({ ok: false, error: 'Membership email run could not be verified.' }, { status: 503, headers }); }
}
