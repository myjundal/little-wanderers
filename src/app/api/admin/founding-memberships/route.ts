import { requireOwnerContext } from '@/lib/authz';
import { activateFounding } from '@/lib/founding-square';
import { squareEnvironment } from '@/lib/square-client';
import { z } from 'zod';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store' };

export async function GET() {
  const context = await requireOwnerContext();
  if (!context.ok) return context.response;
  const result = await context.admin.from('founding_memberships').select('id,status,pricing_tier,base_cents,sibling_cents,amount_cents,start_date,card_last4,created_at,household:households(name,email,phone)').eq('environment', squareEnvironment()).order('created_at', { ascending: false });
  if (result.error) return Response.json({ ok: false, error: 'Unable to load founding memberships. Apply the founding membership migration first.' }, { status: 503, headers });
  const settings = await context.admin.from('founding_membership_settings').select('phase').eq('environment', squareEnvironment()).single();
  if (settings.error) return Response.json({ ok: false, error: 'Unable to load enrollment phase.' }, { status: 503, headers });
  return Response.json({ ok: true, items: result.data, phase: settings.data.phase, billing_enabled: process.env.FOUNDING_BILLING_ENABLED === 'true' }, { headers });
}

export async function PATCH(req: Request) {
  const context = await requireOwnerContext();
  if (!context.ok) return context.response;
  const input = z.object({ phase: z.enum(['waitlist', 'public', 'regular']), previousPhase: z.enum(['waitlist', 'public', 'regular']) }).safeParse(await req.json().catch(() => null));
  if (!input.success) return Response.json({ ok: false, error: 'Choose a valid enrollment phase.' }, { status: 400, headers });
  const result = await context.admin.from('founding_membership_settings').update({ phase: input.data.phase }).eq('environment', squareEnvironment()).eq('phase', input.data.previousPhase).select('phase').maybeSingle();
  if (result.error || !result.data) return Response.json({ ok: false, error: 'The enrollment phase changed. Refresh and try again.' }, { status: 409, headers });
  return Response.json({ ok: true, phase: result.data.phase }, { headers });
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
