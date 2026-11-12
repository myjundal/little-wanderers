import { waitUntil } from '@vercel/functions';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { getLatestHouseholdIdForUser } from '@/lib/households';
import { ensureGuardianProfile, parseGuardianName } from '@/lib/family-profile';
import { classCheckoutRequest, validCheckoutId, readClassCheckout, startClassCheckout, reconcileClassCheckout, closeClassCheckout, cleanupClassCheckouts, publicClassCheckout } from '@/lib/class-checkout';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
export async function POST(req: Request) {
  try {
    const server = await createServerSupabaseClient();
    const { data: { user } } = await server.auth.getUser();
    if (!user) return reply({ ok: false, error: 'Please sign in to register and pay.' }, 401);
    const db = createAdminSupabaseClient();
    const householdId = await getLatestHouseholdIdForUser(db, user.id);
    if (!householdId) return reply({ ok: false, error: 'Please finish setting up your family profile.' }, 404);
    const body = await req.json();
    if (!body || typeof body !== 'object') return reply({ ok: false, error: 'Choose a valid checkout action.' }, 400);
    const mode = body.mode ?? 'create_payment_link';
    if (!['current', 'finalize', 'cancel', 'create_payment_link'].includes(mode)) return reply({ ok: false, error: 'Choose a valid checkout action.' }, 400);
    waitUntil(cleanupClassCheckouts(db));
    if (mode === 'current') {
      let current = await readClassCheckout(db, householdId);
      if (current?.order_id && current.status !== 'needs_review') current = await reconcileClassCheckout(db, current);
      if (current && ['creating', 'open'].includes(current.status) && Date.parse(current.hold_expires_at) <= Date.now()) current = await closeClassCheckout(db, current);
      return reply({ ok: true, checkout: publicClassCheckout(current) });
    }
    if (mode === 'finalize' || mode === 'cancel') {
      if (!validCheckoutId(body.checkout_id)) return reply({ ok: false, error: 'Choose a valid payment.' }, 400);
      const attempt = await readClassCheckout(db, householdId, body.checkout_id);
      if (!attempt) return reply({ ok: false, error: 'Payment not found.' }, 404);
      const current = await (mode === 'cancel' ? closeClassCheckout(db, attempt) : reconcileClassCheckout(db, attempt));
      return reply({ ok: true, checkout: publicClassCheckout(current) });
    }
    const request = classCheckoutRequest(body);
    const guardian = parseGuardianName(body);
    if (!guardian.firstName || !guardian.lastName) return reply({ ok: false, error: 'Enter the parent/guardian first and last name above.' }, 400);
    const existing = await readClassCheckout(db, householdId);
    if (existing?.status === 'needs_review') return reply({ ok: false, error: 'A payment is awaiting staff review. Please contact us before paying again.' }, 409);
    if (existing && JSON.stringify(classCheckoutRequest(existing.payload.request)) !== JSON.stringify(request)) return reply({ ok: false, error: 'Finish or close the pending checkout before changing dates.' }, 409);
    await ensureGuardianProfile({ admin: db, householdId, userId: user.id, email: user.email, firstName: guardian.firstName, lastName: guardian.lastName });
    const attempt = await startClassCheckout(db, { householdId, userId: user.id, email: user.email, request });
    return reply({ ok: true, checkout: publicClassCheckout(attempt) });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const expected = /Choose |Finish |seats|Selected participant|Class selection|checkout expired|pending checkout|Use the separate|in your family|Parent|parent|Payment is in progress|not closed yet|still being prepared/i.test(message);
    if (!expected) console.error('class_checkout_request_failed', message);
    return reply({ ok: false, error: expected ? message : 'Unable to verify checkout right now. Refresh to check your pending payment before trying again.' }, 409);
  }
}
