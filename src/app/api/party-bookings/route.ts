import { onlinePaymentsUnavailable } from '@/lib/online-payment-access';
import { createClient } from '@supabase/supabase-js';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getLatestHouseholdIdForUser } from '@/lib/households';
import { isBookablePartySlot, isOnOrAfterPartyBookingStart, PARTY_BOOKING_START_LABEL } from '@/lib/party-config';
import { ensureGuardianProfile, parseGuardianName } from '@/lib/family-profile';
import { startPartyInvoice, reconcilePartyInvoice, type InvoiceBooking } from '@/lib/square-party';

export const dynamic = 'force-dynamic';
const NO_STORE_HEADERS = { 'cache-control': 'no-store, max-age=0' };
const admin = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const PARTY_SELECT = 'id,start_time,end_time,headcount_expected,price_quote_cents,notes,status,status_updated_at,created_at,final_child_count,final_adult_count,final_total_count,attendance_finalized_at,birthday_child_name,birthday_age,occasion_details,square_invoice_url,square_invoice_status,deposit_paid_cents,balance_paid_cents,payment_review_required';
const PARTY_SELECT_FALLBACK = 'id,start_time,end_time,headcount_expected,price_quote_cents,notes,status,status_updated_at,created_at';
const isMissingColumnError = (message: string) => /column .* does not exist|Could not find the '.*' column/i.test(message);
const getHouseholdIdForUser = (userId: string) => getLatestHouseholdIdForUser(admin(), userId);

async function selectPartyBookings(householdId: string) {
  const supa = admin();
  const primary = await supa.from('party_bookings').select(PARTY_SELECT).eq('household_id', householdId).order('start_time', { ascending: false });
  if (!primary.error) return primary.data ?? [];
  if (!isMissingColumnError(primary.error.message)) throw new Error(primary.error.message);

  const fallback = await supa.from('party_bookings').select(PARTY_SELECT_FALLBACK).eq('household_id', householdId).order('start_time', { ascending: false });
  if (fallback.error) throw new Error(fallback.error.message);

  return (fallback.data ?? []).map((item) => ({
    ...item,
    status: item.status ?? 'confirmed',
    status_updated_at: item.status_updated_at ?? item.created_at,
    final_child_count: null,
    final_adult_count: null,
    final_total_count: null,
    attendance_finalized_at: null,
    birthday_child_name: null,
    birthday_age: null,
    occasion_details: null,
  }));
}

export async function GET() {
  try {
    const server = await createServerSupabaseClient();
    const {
      data: { user },
    } = await server.auth.getUser();

    if (!user) return Response.json({ ok: false, error: 'unauthorized' }, { status: 401, headers: NO_STORE_HEADERS });

    const householdId = await getHouseholdIdForUser(user.id);
    if (!householdId) return Response.json({ ok: true, items: [] }, { headers: NO_STORE_HEADERS });

    const items = await selectPartyBookings(householdId);
    return Response.json({ ok: true, items }, { headers: NO_STORE_HEADERS });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'unknown error';
    return Response.json({ ok: false, error: message }, { status: 500, headers: NO_STORE_HEADERS });
  }
}

export async function POST(req: Request) {
  const unavailable = onlinePaymentsUnavailable('party');
  if (unavailable) return unavailable;
  try {
    const body = await req.json();
    const server = await createServerSupabaseClient();
    const { data: { user } } = await server.auth.getUser();
    if (!user) return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    const supa = admin();
    const householdId = await getHouseholdIdForUser(user.id);
    if (!householdId) return Response.json({ ok: false, error: 'household not found' }, { status: 404 });

    // Kept for old clients: this action only reads verified provider state. It cannot grant a reservation.
    if (body.mode === 'finalize') {
      if (!body.booking_id) return Response.json({ ok: false, error: 'booking_id is required' }, { status: 400 });
      const { data: booking, error } = await supa.from('party_bookings').select('*').eq('id', body.booking_id).eq('household_id', householdId).maybeSingle();
      if (error) throw new Error(error.message);
      if (!booking?.square_invoice_id) return Response.json({ ok: false, error: 'Invoice not found' }, { status: 404 });
      const verified = await reconcilePartyInvoice(supa, booking as InvoiceBooking);
      return Response.json({ ok: true, id: verified.id, status: verified.status, deposit_paid_cents: verified.deposit_paid_cents,
        balance_paid_cents: verified.balance_paid_cents, payment_review_required: verified.payment_review_required });
    }
    if (body.mode && body.mode !== 'create_payment_link') {
      return Response.json({ ok: false, error: 'Unsupported booking action' }, { status: 400 });
    }
    const start = new Date(body.start_time), end = new Date(body.end_time);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start || start.getTime() <= Date.now()) {
      return Response.json({ ok: false, error: 'Choose a valid future party time' }, { status: 400 });
    }
    if (!isOnOrAfterPartyBookingStart(start) || !isBookablePartySlot(start, end, body.slot)) {
      return Response.json({ ok: false, error: `Choose an available party slot on or after ${PARTY_BOOKING_START_LABEL}.` }, { status: 400 });
    }
    const age = body.birthday_age == null ? null : Number(body.birthday_age);
    const headcount = body.headcount_expected == null ? null : Number(body.headcount_expected);
    if ((age != null && (!Number.isInteger(age) || age < 1 || age > 21))
      || (headcount != null && (!Number.isInteger(headcount) || headcount < 1 || headcount > 300))) {
      return Response.json({ ok: false, error: 'Invalid age or guest count' }, { status: 400 });
    }
    const guardian = parseGuardianName(body);
    await ensureGuardianProfile({ admin: supa, householdId, userId: user.id, email: user.email,
      firstName: guardian.firstName, lastName: guardian.lastName });
    const result = await startPartyInvoice(supa, {
      householdId, userId: user.id, role: 'customer', email: user.email,
      booking: { start_time: start.toISOString(), end_time: end.toISOString(), headcount_expected: headcount,
        birthday_age: age, birthday_child_name: typeof body.birthday_child_name === 'string' ? body.birthday_child_name.trim().slice(0,80) : null,
        occasion_details: typeof body.occasion_details === 'string' ? body.occasion_details.trim().slice(0,120) : null,
        notes: typeof body.notes === 'string' ? body.notes.slice(0,2000) : null },
    });
    return Response.json({ ok: true, id: result.booking.id, status: result.booking.status, payment_url: result.url,
      deposit_cents: 15000, total_cents: 30000 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to start party checkout';
    return Response.json({ ok: false, error: message }, { status: /already|slot|reservation exists/i.test(message) ? 409 : 500 });
  }
}
