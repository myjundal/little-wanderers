import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getLatestHouseholdIdForUser } from '@/lib/households';
import { ensureGuardianProfile, parseGuardianName } from '@/lib/family-profile';
import { createSeriesInvoiceDraft, publishSeriesInvoice, readSeriesSale, verifySeriesPayment, reconcileSeriesSales, JAMIE_PROGRAM_ID } from '@/lib/class-series-payments';
import { squareConfig } from '@/lib/square-client';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
async function context() {
  const server = await createServerSupabaseClient();
  const { data: { user } } = await server.auth.getUser();
  if (!user) return null;
  const db = createAdminSupabaseClient();
  const householdId = await getLatestHouseholdIdForUser(db, user.id);
  return householdId ? { db, user, householdId } : null;
}
export async function GET(req: Request) {
  const ctx = await context();
  if (!ctx) return Response.json({ ok: false, error: 'Please sign in.' }, { status: 401 });
  const id = new URL(req.url).searchParams.get('id');
  try {
    if (!id || !uuid.test(id)) return Response.json({ ok: false, error: 'Choose a valid payment.' }, { status: 400 });
    let sale = await readSeriesSale(ctx.db, id);
    if (sale.household_id !== ctx.householdId) return Response.json({ ok: false, error: 'Payment not found.' }, { status: 404 });
    sale = await verifySeriesPayment(ctx.db, sale);
    return Response.json({ ok: true, status: sale.status, amount_cents: sale.amount_cents }, { headers: { 'cache-control': 'no-store' } });
  } catch {
    return Response.json({ ok: false, error: 'Unable to verify payment yet. Refresh to check again.' }, { status: 502 });
  }
}
export async function POST(req: Request) {
  const ctx = await context();
  if (!ctx) return Response.json({ ok: false, error: 'Please sign in.' }, { status: 401 });
  try {
    const body = await req.json();
    if (body.accept_terms !== true || !Array.isArray(body.child_ids) || !body.child_ids.length || body.child_ids.length > 7 || body.child_ids.some((id: unknown) => typeof id !== 'string' || !uuid.test(id))) {
      return Response.json({ ok: false, error: 'Choose your children and accept the series payment terms.' }, { status: 400 });
    }
    const guardian = parseGuardianName(body);
    if (!guardian.firstName || !guardian.lastName) return Response.json({ ok: false, error: 'Enter the parent/guardian first and last name.' }, { status: 400 });
    // Check the switch before touching Square or creating customer records.
    const { data: program, error } = await ctx.db.from('class_series_programs').select('payments_enabled,due_at').eq('id', JAMIE_PROGRAM_ID).maybeSingle();
    if (error || !program?.payments_enabled) return Response.json({ ok: false, error: 'Paid registration is not open yet.' }, { status: 503 });
    if (Date.parse(program.due_at) <= Date.now()) return Response.json({ ok: false, error: 'The series payment deadline has passed. Please contact us.' }, { status: 409 });
    await ensureGuardianProfile({ admin: ctx.db, householdId: ctx.householdId, userId: ctx.user.id, email: ctx.user.email, firstName: guardian.firstName, lastName: guardian.lastName });
    // Reconcile completed payments. Unpaid invoices and checkout pages do not reserve seats.
    await reconcileSeriesSales(ctx.db);
    let sale = await createSeriesInvoiceDraft(ctx.db, { householdId: ctx.householdId, childIds: body.child_ids, userId: ctx.user.id, source: 'online' });
    const { error: termsError } = await ctx.db.from('class_series_sales').update({ terms_accepted_at: new Date().toISOString(), terms_accepted_by_user_id: ctx.user.id }).eq('id', sale.id);
    if (termsError) throw termsError;
    sale = await publishSeriesInvoice(ctx.db, sale, false);
    return Response.json({ ok: true, sale_id: sale.id, status: sale.status, amount_cents: sale.amount_cents, payment_url: sale.payment_url, environment: squareConfig().environment });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to open checkout.';
    const customerErrors = ['seats', 'already', 'Choose', 'deadline', 'Family access', 'email address', 'not open', 'needs review', 'contact us'];
    return Response.json({ ok: false, error: customerErrors.some(part => message.includes(part)) ? message : 'Unable to open checkout. Please try again or contact us.' }, { status: 409 });
  }
}
