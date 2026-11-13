import { requireOwnerContext } from '@/lib/authz';
import { activateFounding, foundingCardConfig } from '@/lib/founding-square';
import { foundingBillingDetails, ownerFoundingBillingEnabled, verifyFoundingBillingCard } from '@/lib/founding-billing-activation';
import { squareEnvironment, squareRequest } from '@/lib/square-client';
import type { FoundingEnrollment } from '@/lib/founding-membership';
import { z } from 'zod';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const headers = { 'Cache-Control': 'private, no-store', Vary: 'Cookie' };

export async function GET(req: Request) {
  const context = await requireOwnerContext();
  if (!context.ok) return context.response;
  const reviewId = req ? new URL(req.url).searchParams.get('review') : null;
  if (reviewId) {
    const row = await context.admin.from('founding_memberships').select('*').eq('id', reviewId).eq('environment', squareEnvironment()).single();
    if (row.error || !row.data) return Response.json({ ok: false, error: 'Membership not found.' }, { status: 404, headers });
    try {
      const details = await foundingBillingDetails(context.admin, row.data as FoundingEnrollment);
      if (details.error) return Response.json({ ok: false, error: details.error }, { status: 409, headers });
      const card = await verifyFoundingBillingCard(row.data as FoundingEnrollment);
      return Response.json({ ok: true, review: { enrollment_id: row.data.id, ...details, ...card }, billing_enabled: ownerFoundingBillingEnabled(context.user), charges_executed: false }, { headers });
    } catch (error) { return Response.json({ ok: false, error: error instanceof Error && !error.message.startsWith('Square request') ? error.message : 'Unable to verify the saved card and existing subscriptions. No billing has been started.' }, { status: 503, headers }); }
  }
  const result = await context.admin.from('founding_memberships').select('id,status,pricing_tier,base_cents,sibling_cents,amount_cents,start_date,card_last4,created_at,household:households(name,email,phone)').eq('environment', squareEnvironment()).order('created_at', { ascending: false });
  if (result.error) return Response.json({ ok: false, error: 'Unable to load founding memberships.' }, { status: 503, headers });
  const settings = await context.admin.from('founding_membership_settings').select('phase,card_enrollment_enabled').eq('environment', squareEnvironment()).single();
  if (settings.error) return Response.json({ ok: false, error: 'Unable to load enrollment phase.' }, { status: 503, headers });
  let cardConfigured = false; let locationVerified: boolean | null = null;
  try {
    const config = foundingCardConfig(settings.data.card_enrollment_enabled);
    cardConfigured = true;
    if (req && new URL(req.url).searchParams.get('verifySquare') === '1') {
      const location = await squareRequest<{ location: { id: string; status: string } }>(`/v2/locations/${encodeURIComponent(config.locationId)}`);
      locationVerified = location.location?.id === config.locationId && location.location.status === 'ACTIVE';
    }
  } catch { if (req && new URL(req.url).searchParams.get('verifySquare') === '1') locationVerified = false; }
  return Response.json({ ok: true, items: result.data, phase: settings.data.phase, billing_enabled: ownerFoundingBillingEnabled(context.user),
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
  const origin = req.headers?.get('origin');
  if (origin && origin !== new URL(req.url).origin) return Response.json({ ok: false, error: 'forbidden' }, { status: 403, headers });
  const input = z.object({ id: z.string().uuid(), startDate: z.string(), expectedAmountCents: z.number().int().positive(), confirmation: z.literal('START MONTHLY BILLING'), firstVisitConfirmed: z.literal(true) }).safeParse(await req.json().catch(() => null));
  if (!input.success) return Response.json({ ok: false, error: 'Review the monthly amount and confirm this family’s first membership visit before activation.' }, { status: 400, headers });
  if (!ownerFoundingBillingEnabled(context.user)) return Response.json({ ok: false, error: 'Billing activation is not enabled for this owner account.' }, { status: 403, headers });
  try {
    const result = await context.admin.from('founding_memberships').select('*').eq('id', input.data.id).eq('environment', squareEnvironment()).single();
    if (result.error || !result.data) throw new Error('Membership not found.');
    if (['active', 'scheduled'].includes(result.data.status)) return Response.json({ ok: true, already_started: true }, { headers });
    const details = await foundingBillingDetails(context.admin, result.data as FoundingEnrollment);
    if (details.error || details.start_date !== input.data.startDate || details.amount_cents !== input.data.expectedAmountCents) return Response.json({ ok: false, error: details.error || 'The first visit or monthly amount changed. Review this family again.' }, { status: 409, headers });
    await activateFounding(context.admin, result.data, input.data.startDate, { ownerAuthorized: true, ownerUserId: context.user.id });
    return Response.json({ ok: true }, { headers });
  } catch (error) {
    const message = error instanceof Error && !error.message.startsWith('Square request') ? error.message : 'Square could not confirm activation. Retry this family using the same first-visit date.';
    return Response.json({ ok: false, error: message }, { status: 503, headers });
  }
}
