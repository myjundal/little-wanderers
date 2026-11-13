import { requireOwnerContext } from '@/lib/authz';
import { membershipNoticeTriggerToken } from '@/lib/membership-billing-notice-auth';
import { runMembershipBillingNotices } from '@/lib/membership-billing-notice-runner.mjs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;
const headers = { 'cache-control': 'private, no-store', Vary: 'Cookie' };

export async function GET() {
  const context = await requireOwnerContext();
  if (!context.ok) return context.response;
  try {
    const preview = await runMembershipBillingNotices({ db: context.admin, mode: 'preview' });
    return Response.json({ ok: true, transport_configured: Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL), production: process.env.VERCEL_ENV === 'production', preview, charges_executed: false }, { headers });
  } catch { return Response.json({ ok: false, error: 'Unable to preview membership notices.' }, { status: 503, headers }); }
}

/** Personal owner access provisions only the narrow email-job credential. */
export async function POST(req: Request) {
  const context = await requireOwnerContext();
  if (!context.ok) return context.response;
  const origin = req.headers.get('origin');
  if (origin && origin !== new URL(req.url).origin) return Response.json({ ok: false, error: 'forbidden' }, { status: 403, headers });
  const input = await req.json().catch(() => null);
  if (input?.action !== 'provision_scheduler_token') return Response.json({ ok: false, error: 'Invalid action.' }, { status: 400, headers });
  if (process.env.VERCEL_ENV !== 'production') return Response.json({ ok: false, error: 'Production only.' }, { status: 409, headers });
  try { return Response.json({ ok: true, token: membershipNoticeTriggerToken() }, { headers }); }
  catch { return Response.json({ ok: false, error: 'Email transport unavailable.' }, { status: 503, headers }); }
}
