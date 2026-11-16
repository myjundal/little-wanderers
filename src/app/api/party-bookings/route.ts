import { z } from 'zod';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getLatestHouseholdIdForUser } from '@/lib/households';
import { ensureGuardianProfile, parseGuardianName } from '@/lib/family-profile';
import { isBookablePartySlot } from '@/lib/party-config';
import { isSameOriginRequest } from '@/lib/request-origin';
import { readPartyCheckout, startPartyCheckout, reconcilePartyCheckout, closePartyCheckout, publicPartyCheckout, cleanupPartyCheckouts } from '@/lib/party-deposit';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
async function context() {
  const server = await createServerSupabaseClient();
  const { data: { user } } = await server.auth.getUser();
  if (!user) return { response: reply({ ok: false, error: 'Please sign in to book a party.' }, 401) };
  const db = createAdminSupabaseClient();
  const householdId = await getLatestHouseholdIdForUser(db, user.id);
  if (!householdId) return { response: reply({ ok: false, error: 'Please finish setting up your family account.' }, 404) };
  return { db, user, householdId };
}
export async function GET() {
  try {
    const ctx = await context(); if (ctx.response) return ctx.response;
    await cleanupPartyCheckouts(ctx.db);
    let checkout = await readPartyCheckout(ctx.db, ctx.householdId);
    if (checkout) checkout = await reconcilePartyCheckout(ctx.db, checkout);
    const result = await ctx.db.from('party_bookings').select('id,start_time,end_time,headcount_expected,price_quote_cents,notes,status,status_updated_at,created_at,final_child_count,final_adult_count,final_total_count,attendance_finalized_at,birthday_child_name,birthday_age,occasion_details,deposit_paid_cents,balance_paid_cents,square_invoice_url').eq('household_id', ctx.householdId).order('start_time', { ascending: false });
    if (result.error) throw new Error('Unable to load party bookings.');
    return reply({ ok: true, items: result.data ?? [], checkout: publicPartyCheckout(checkout) });
  } catch { return reply({ ok: false, error: 'Unable to verify party bookings. Please refresh before trying again.' }, 503); }
}
const request = z.object({ start_time: z.string().datetime({ offset: true }), end_time: z.string().datetime({ offset: true }),
  headcount_expected: z.number().int().min(1).max(200).nullable().default(null), notes: z.string().trim().max(2000).nullable().default(null),
  birthday_child_name: z.string().trim().max(80).nullable().default(null), birthday_age: z.number().int().min(1).max(21).nullable().default(null), occasion_details: z.string().trim().max(120).nullable().default(null) });
export async function POST(req: Request) {
  try {
    const ctx = await context(); if (ctx.response) return ctx.response;
    if (!isSameOriginRequest(req)) return reply({ ok: false, error: 'Invalid request origin.' }, 403);
    const body = await req.json();
    if (['finalize', 'cancel_checkout'].includes(body.mode)) {
      const id = z.string().uuid().safeParse(body.checkout_id);
      if (!id.success) return reply({ ok: false, error: 'Choose a valid checkout.' }, 400);
      const checkout = await readPartyCheckout(ctx.db, ctx.householdId, id.data);
      if (!checkout) return reply({ ok: false, error: 'Party checkout not found.' }, 404);
      const current = await (body.mode === 'finalize' ? reconcilePartyCheckout(ctx.db, checkout) : closePartyCheckout(ctx.db, checkout));
      return reply({ ok: true, checkout: publicPartyCheckout(current) });
    }
    if (body.mode !== 'create_payment_link') return reply({ ok: false, error: 'A $150 deposit is required to confirm a new party booking.' }, 400);
    const parsed = request.safeParse(body);
    if (!parsed.success) return reply({ ok: false, error: 'Complete your party details and choose a valid date.' }, 400);
    const start = new Date(parsed.data.start_time), end = new Date(parsed.data.end_time);
    if (start.getTime() <= Date.now() || !isBookablePartySlot(start, end)) return reply({ ok: false, error: 'Choose an available Friday afternoon, Saturday, or Sunday party slot.' }, 400);
    const guardian = parseGuardianName(body);
    if (!guardian.firstName || !guardian.lastName) return reply({ ok: false, error: 'Enter the parent/guardian first and last name.' }, 400);
    await ensureGuardianProfile({ admin: ctx.db, householdId: ctx.householdId, userId: ctx.user.id, email: ctx.user.email, firstName: guardian.firstName, lastName: guardian.lastName });
    const checkout = await startPartyCheckout(ctx.db, ctx.householdId, ctx.user.id, { ...parsed.data, start_time: start.toISOString(), end_time: end.toISOString() }, ctx.user.email);
    return reply({ ok: true, checkout: publicPartyCheckout(checkout), payment_url: checkout.payment_url, deposit_cents: checkout.expected_amount_cents });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    return reply({ ok: false, error: /^(Finish or close|That party slot|Your checkout expired|Your deposit|A party payment|Your party booking|Payment is in progress|Payment has not closed|Deposit received)/.test(message) ? message : 'Unable to verify your party payment. Refresh to resume your pending checkout before trying again.' }, 409);
  }
}
