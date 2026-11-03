import { requireOwnerContext } from '@/lib/authz';
import { activateFounding } from '@/lib/founding-square';
import { squareEnvironment } from '@/lib/square-client';
import { z } from 'zod';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store' };

export async function GET() {
  const context = await requireOwnerContext();
  if (!context.ok) return context.response;
  const result = await context.admin.from('founding_memberships').select('id,status,amount_cents,start_date,card_last4,created_at,household:households(name,email,phone)').eq('environment', squareEnvironment()).order('created_at', { ascending: false });
  if (result.error) return Response.json({ ok: false, error: 'Unable to load founding memberships. Apply the founding membership migration first.' }, { status: 503, headers });
  return Response.json({ ok: true, items: result.data, billing_enabled: process.env.FOUNDING_BILLING_ENABLED === 'true' }, { headers });
}

export async function POST(req: Request) {
  const context = await requireOwnerContext();
  if (!context.ok) return context.response;
  const input = z.object({ id: z.string().uuid(), startDate: z.string(), confirmation: z.literal('START MONTHLY BILLING') }).safeParse(await req.json().catch(() => null));
  if (!input.success) return Response.json({ ok: false, error: 'An explicit opening date and billing confirmation are required.' }, { status: 400, headers });
  try {
    const result = await context.admin.from('founding_memberships').select('*').eq('id', input.data.id).eq('environment', squareEnvironment()).single();
    if (result.error || !result.data) throw new Error('Membership not found.');
    await activateFounding(context.admin, result.data, input.data.startDate);
    return Response.json({ ok: true }, { headers });
  } catch (error) {
    const message = error instanceof Error && !error.message.startsWith('Square request') ? error.message : 'Square could not confirm activation. Retry using the same opening date.';
    return Response.json({ ok: false, error: message }, { status: 503, headers });
  }
}
