import type { SupabaseClient } from '@supabase/supabase-js';
import { squareConfig } from '@/lib/square-client';
import { startPartyInvoice, ensurePartyInvoice, reconcilePartyInvoice, cancelPartyInvoice, expirePartyInvoiceHolds, type InvoiceBooking } from '@/lib/square-party';
import { PARTY_DEPOSIT_CENTS } from '@/lib/party-info';
import { sendPartyConfirmationEmail } from '@/lib/party-emails';
import { sendPartyBookingNotification } from '@/lib/admin-notifications';
export type PartyRequest = { start_time: string; end_time: string; headcount_expected: number | null; notes: string | null; birthday_child_name: string | null; birthday_age: number | null; occasion_details: string | null };
type Booking = InvoiceBooking & Partial<PartyRequest>;
export type PartyCheckout = ReturnType<typeof partyCheckoutFromBooking>;
export function partyCheckoutFromBooking(b: Booking) {
  return { id: b.id, household_id: b.household_id, status: b.payment_review_required ? 'needs_review' : b.status === 'confirmed' ? 'completed' : b.status === 'cancelled' ? 'cancelled' : b.square_invoice_url ? 'open' : 'creating',
    payment_url: b.square_invoice_url, expected_amount_cents: PARTY_DEPOSIT_CENTS, hold_expires_at: b.payment_hold_expires_at,
    payload: { booking_id: b.id, request: { start_time: new Date(b.start_time).toISOString(), end_time: new Date(b.end_time).toISOString(), headcount_expected: b.headcount_expected ?? null, notes: b.notes ?? null, birthday_child_name: b.birthday_child_name ?? null, birthday_age: b.birthday_age ?? null, occasion_details: b.occasion_details ?? null } } };
}
export const publicPartyCheckout = (a: PartyCheckout | null) => a ? { id: a.id, booking_id: a.id, status: a.status, payment_url: a.payment_url, deposit_cents: a.expected_amount_cents, start_time: a.payload.request.start_time, end_time: a.payload.request.end_time, expires_at: a.hold_expires_at } : null;
async function readBooking(db: SupabaseClient, family: string, id: string) {
  const result = await db.from('party_bookings').select('*').eq('household_id', family).eq('id', id).eq('square_environment', squareConfig().environment).maybeSingle();
  if (result.error) throw new Error('Unable to verify party payment.');
  return result.data as Booking | null;
}
export async function readPartyCheckout(db: SupabaseClient, family: string, id?: string) {
  if (id) { const booking = await readBooking(db, family, id); return booking ? partyCheckoutFromBooking(booking) : null; }
  const result = await db.from('party_bookings').select('*').eq('household_id', family).eq('square_environment', squareConfig().environment).eq('status', 'pending').order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (result.error) throw new Error('Unable to load pending party payment.');
  return result.data ? partyCheckoutFromBooking(result.data as Booking) : null;
}
export async function startPartyCheckout(db: SupabaseClient, family: string, user: string, request: PartyRequest, email?: string | null) {
  const current = await readPartyCheckout(db, family);
  if (current) {
    const same = Object.entries(request).every(([key, value]) => current.payload.request[key as keyof PartyRequest] === value);
    if (!same) throw new Error('Finish or close your pending party payment before choosing a different date.');
    if (current.status === 'needs_review') throw new Error('Your deposit needs staff review. Please contact us before paying again.');
    if (current.hold_expires_at && Date.parse(current.hold_expires_at) <= Date.now()) { await closePartyCheckout(db, current); throw new Error('Your checkout expired. Please choose your party date again.'); }
    const row = await readBooking(db, family, current.id);
    if (!row) throw new Error('Party booking changed. Please refresh.');
    return partyCheckoutFromBooking((await ensurePartyInvoice(db, row, email)).booking as Booking);
  }
  return partyCheckoutFromBooking((await startPartyInvoice(db, { householdId: family, userId: user, role: 'customer', email, booking: request })).booking as Booking);
}
export async function reconcilePartyCheckout(db: SupabaseClient, a: PartyCheckout) {
  let booking = await readBooking(db, a.household_id, a.id);
  if (!booking) throw new Error('Party checkout not found.');
  if (!booking.square_invoice_id && booking.status === 'pending') booking = (await ensurePartyInvoice(db, booking)).booking as Booking;
  if (!booking.square_invoice_id) return partyCheckoutFromBooking(booking);
  const verified = await reconcilePartyInvoice(db, booking);
  if (verified.status === 'confirmed' && !verified.payment_review_required && verified.deposit_paid_cents >= PARTY_DEPOSIT_CENTS) {
    await sendPartyConfirmationEmail(db, verified.id).catch(() => null);
    if (booking.status !== 'confirmed') {
      const family = await db.from('households').select('name,email').eq('id', booking.household_id).maybeSingle();
      await sendPartyBookingNotification({ bookingId: verified.id, startTime: booking.start_time, endTime: booking.end_time, status: 'confirmed', familyName: family.data?.name, familyEmail: family.data?.email, birthdayChildName: booking.birthday_child_name, birthdayAge: booking.birthday_age, headcountExpected: booking.headcount_expected, notes: booking.notes }).catch(() => null);
    }
  }
  return partyCheckoutFromBooking(verified as Booking);
}
export async function closePartyCheckout(db: SupabaseClient, a: PartyCheckout) {
  const booking = await readBooking(db, a.household_id, a.id);
  if (!booking) throw new Error('Party checkout not found.');
  if (booking.square_invoice_id) {
    const current = await reconcilePartyCheckout(db, a);
    if (current.status === 'completed' || current.status === 'needs_review') return current;
  }
  if (booking.status !== 'pending') return partyCheckoutFromBooking(booking);
  return partyCheckoutFromBooking(await cancelPartyInvoice(db, booking) as Booking);
}
export async function cleanupPartyCheckouts(db: SupabaseClient) {
  await expirePartyInvoiceHolds(db);
}
