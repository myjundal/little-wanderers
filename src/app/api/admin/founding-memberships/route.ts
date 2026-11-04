import { requireOwnerContext } from '@/lib/authz';
import { activateFounding, foundingCardConfig } from '@/lib/founding-square';
import { squareEnvironment, squareRequest } from '@/lib/square-client';
import { z } from 'zod';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store' };

export async function GET(req: Request) {
  const context = await requireOwnerContext();
  if (!context.ok) return context.response;
  const result = await context.admin.from('founding_memberships').select('id,status,pricing_tier,base_cents,sibling_cents,amount_cents,start_date,card_last4,created_at,household:households(name,email,phone)').eq('environment', squareEnvironment()).order('created_at', { ascending: false });
  if (result.error) return Response.json({ ok: false, error: 'Unable to load founding memberships. Apply the founding membership migration first.' }, { status: 503, headers });
  const settings = await context.admin.from('founding_membership_settings').select('phase,card_enrollment_enabled').eq('environment', squareEnvironment()).single();
  if (settings.error) return Response.json({ ok: false, error: 'Unable to load enrollment phase.' }, { status: 503, headers });
  let cardConfigured = false; let locationVerified: boolean | null = null;
  try {
    const config = foundingCardConfig(settings.data.card_enrollment_enabled);
    cardConfigured = true;
    if (req && new URL(req.url).searchParams.get('verifySquare') === '1') {
      const result = await squareRequest<{ location: { id: string; status: string } }>(`/v2/locations/${encodeURIComponent(config.locationId)}`);
      locationVerified = result.location?.id === config.locationId && result.location.status === 'ACTIVE';
    }
  } catch { if (req && new URL(req.url).searchParams.get('verifySquare') === '1') locationVerified = false; }
  return Response.json({ ok: true, items: result.data, phase: settings.data.phase, billing_enabled: process.env.FOUNDING_BILLING_ENABLED === 'true',
    integration: { environment: squareEnvironment(), card_configured: cardConfigured, square_location_verified: locationVerified, owner_email_configured: Boolean(process.env.RESEND_API_KEY) },
  }, { headers });
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
  const input = z.object({ id: z.string().uuid(), startDate: z.string(), confirmation: z.literal('START MONTHLY BILLING'), firstVisitConfirmed: z.literal(true) }).safeParse(await req.json().catch(() => null));
  if (!input.success) return Response.json({ ok: false, error: 'Confirm this family’s first membership visit, its date, and monthly billing before activation.' }, { status: 400, headers });
  try {
    const result = await context.admin.from('founding_memberships').select('*').eq('id', input.data.id).eq('environment', squareEnvironment()).single();
    if (result.error || !result.data) throw new Error('Membership not found.');
    await activateFounding(context.admin, result.data, input.data.startDate);
    return Response.json({ ok: true }, { headers });
  } catch (error) {
    const message = error instanceof Error && !error.message.startsWith('Square request') ? error.message : 'Square could not confirm activation. Retry using the same first-visit date.';
    return Response.json({ ok: false, error: message }, { status: 503, headers });
  }
}
