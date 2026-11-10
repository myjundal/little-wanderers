import { requireOwnerContext } from '@/lib/authz';
import { squareEnvironment } from '@/lib/square-client';
import { loadMembershipSummary } from '@/lib/membership-summary';
export const dynamic = 'force-dynamic';
export async function GET() {
  const context = await requireOwnerContext();
  if (!context.ok) return context.response;
  const headers = { 'Cache-Control': 'private, no-store' };
  try { return Response.json({ ok: true, summary: await loadMembershipSummary(context.admin, squareEnvironment()) }, { headers }); }
  catch { return Response.json({ ok: false, error: 'Unable to load membership totals. Please try again.' }, { status: 503, headers }); }
}
