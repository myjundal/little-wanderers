import { createClient } from '@supabase/supabase-js';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getLatestHouseholdIdForUser } from '@/lib/households';
import crypto from 'crypto';
import { buildPrePopulatedData, logSquarePayload } from '@/lib/square';
import { isOnOrAfterPartyBookingStart, PARTY_BOOKING_START_LABEL } from '@/lib/party-config';
import { normalizeWaitlistEmail } from '@/lib/waitlist';
import { sendPartyBookingNotification } from '@/lib/admin-notifications';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';
const NO_STORE_HEADERS = { 'cache-control': 'no-store, max-age=0' };

const PARTY_SELECT = 'id,start_time,end_time,headcount_expected,price_quote_cents,notes,status,status_updated_at,created_at,final_child_count,final_adult_count,final_total_count,attendance_finalized_at,birthday_child_name,birthday_age,occasion_details';
const PARTY_SELECT_FALLBACK = 'id,start_time,end_time,headcount_expected,price_quote_cents,notes,status,status_updated_at,created_at';

const PARTY_TOTAL_FEE_CENTS = 30000;
const PARTY_DEPOSIT_CENTS = 15000;

type PartyPayload = {
  start_time?: string;
  end_time?: string;
  headcount_expected?: number | null;
  notes?: string | null;
  slot?: '10:00' | '15:00';
  mode?: 'create_payment_link' | 'finalize' | 'early_access_hold';
  birthday_child_name?: string | null;
  birthday_age?: number | null;
  occasion_details?: string | null;
  booking_id?: string;
};

const admin = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

function isMissingColumnError(message: string) {
  return /column .* does not exist|Could not find the '.*' column/i.test(message);
}

function getSquareBaseUrl() {
  const env = (process.env.SQUARE_ENVIRONMENT ?? process.env.SQUARE_ENV ?? 'sandbox').toLowerCase();
  return env === 'production' ? 'https://connect.squareup.com' : 'https://connect.squareupsandbox.com';
}

function isPartySlot(start: Date, end: Date, slot?: string) {
  const day = start.getUTCDay();
  const isPartyDay = day === 5 || day === 6 || day === 0;
  const durationHours = (end.getTime() - start.getTime()) / 3_600_000;
  const validSlot = slot === '10:00' || slot === '15:00';
  return isPartyDay && validSlot && durationHours === 3;
}

async function getHouseholdIdForUser(userId: string) {
  return getLatestHouseholdIdForUser(admin(), userId);
}

async function tagPartyEarlyAccessContact(input: { email: string | undefined; householdId: string }) {
  if (!input.email) return;

  const email = input.email.trim().toLowerCase();
  const normalizedEmail = normalizeWaitlistEmail(email);
  if (!normalizedEmail) return;

  const supa = admin();
  const { data: contact, error } = await supa
    .from('contacts')
    .upsert({
      email,
      normalized_email: normalizedEmail,
      source: 'customer',
      raw_metadata: { household_id: input.householdId },
    }, { onConflict: 'normalized_email' })
    .select('id')
    .maybeSingle();

  if (error || !contact?.id) {
    console.warn('party contact tag upsert failed', error?.message);
    return;
  }

  const { error: customerTagError } = await supa
    .from('contact_tags')
    .upsert({ contact_id: contact.id, tag: 'customer' }, { onConflict: 'contact_id,tag' });
  if (customerTagError) console.warn('customer contact tag failed', customerTagError.message);

  const { error: partyTagError } = await supa
    .from('contact_tags')
    .upsert({ contact_id: contact.id, tag: 'party_early_access' }, { onConflict: 'contact_id,tag' });
  if (partyTagError) console.warn('party early access contact tag failed', partyTagError.message);
}

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

async function notifyPartyBookingSaved(input: { bookingId?: string | null; startTime: string; endTime: string; status: string }) {
  try {
    const notification = await sendPartyBookingNotification({
      startTime: input.startTime,
      endTime: input.endTime,
      status: input.status,
    });

    if (!notification.ok) {
      logger.error(
        { action: 'party_booking_notification.failed', bookingId: input.bookingId ?? null, status: input.status },
        new Error(notification.error)
      );
    }
  } catch (notificationError) {
    logger.error(
      { action: 'party_booking_notification.failed', bookingId: input.bookingId ?? null, status: input.status },
      notificationError
    );
  }
}

export async function GET() {
  try {
    const server = createServerSupabaseClient();
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
  try {
    const body = (await req.json()) as PartyPayload;
    const startTime = body?.start_time;
    const endTime = body?.end_time;
    const headcountExpected = body?.headcount_expected == null ? null : Number(body.headcount_expected);
    const notes = (body?.notes as string | null) ?? null;
    const slot = typeof body.slot === 'string' ? body.slot : undefined;
    const birthdayChildName = typeof body.birthday_child_name === 'string' ? body.birthday_child_name.trim().slice(0, 80) : null;
    const birthdayAge = body?.birthday_age == null ? null : Number(body.birthday_age);
    const occasionDetails = typeof body.occasion_details === 'string' ? body.occasion_details.trim().slice(0, 120) : null;
    const mode = body.mode ?? 'create_payment_link';
    const bookingId = typeof body.booking_id === 'string' ? body.booking_id : null;

    if (!startTime || !endTime) {
      return Response.json({ ok: false, error: 'start_time and end_time are required' }, { status: 400 });
    }

    const start = new Date(startTime);
    const end = new Date(endTime);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      return Response.json({ ok: false, error: 'invalid time range' }, { status: 400 });
    }

    if (!isPartySlot(start, end, slot)) {
      return Response.json({ ok: false, error: 'Party bookings are only available on Friday, Saturday, or Sunday at 10:00 AM or 3:00 PM.' }, { status: 400 });
    }
    if (!isOnOrAfterPartyBookingStart(start)) {
      return Response.json({ ok: false, error: `Party bookings are available starting ${PARTY_BOOKING_START_LABEL}.` }, { status: 400 });
    }
    if (birthdayAge != null && (!Number.isInteger(birthdayAge) || birthdayAge <= 0 || birthdayAge > 21)) {
      return Response.json({ ok: false, error: 'birthday_age must be a positive whole number' }, { status: 400 });
    }

    const server = createServerSupabaseClient();
    const {
      data: { user },
    } = await server.auth.getUser();

    if (!user) return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });

    const householdId = await getHouseholdIdForUser(user.id);
    if (!householdId) return Response.json({ ok: false, error: 'household not found' }, { status: 404 });

    const supa = admin();
    const { data: existingSameSlot } = await supa
      .from('party_bookings')
      .select('id,status')
      .eq('household_id', householdId)
      .eq('start_time', start.toISOString())
      .eq('end_time', end.toISOString())
      .neq('status', 'cancelled')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (mode === 'finalize' && existingSameSlot) {
      const updateExisting = await supa.from('party_bookings').update({
        headcount_expected: headcountExpected,
        notes,
        birthday_child_name: birthdayChildName,
        birthday_age: birthdayAge,
        occasion_details: occasionDetails,
        status: 'confirmed',
        status_updated_at: new Date().toISOString(),
      }).eq('id', existingSameSlot.id).eq('household_id', householdId).select('id').maybeSingle();
      if (!updateExisting.error && updateExisting.data?.id) {
        await notifyPartyBookingSaved({
          bookingId: updateExisting.data.id,
          startTime: start.toISOString(),
          endTime: end.toISOString(),
          status: 'confirmed',
        });
        return Response.json({ ok: true, id: updateExisting.data.id, status: 'confirmed', deposit_paid_cents: PARTY_DEPOSIT_CENTS });
      }
    }

    const { data: conflicts, error: conflictErr } = await supa
      .from('party_bookings')
      .select('id,household_id,start_time,end_time,status')
      .lt('start_time', end.toISOString())
      .gt('end_time', start.toISOString())
      .neq('status', 'cancelled');

    if (conflictErr) return Response.json({ ok: false, error: conflictErr.message }, { status: 500 });
    const conflictingBookings = (conflicts ?? []).filter((item) => item.household_id !== householdId && item.id !== existingSameSlot?.id);
    if (conflictingBookings.length > 0) {
      return Response.json({ ok: false, error: 'That party slot is already booked.' }, { status: 409 });
    }

    if (mode === 'early_access_hold') {
      await tagPartyEarlyAccessContact({ email: user.email, householdId });

      const holdPayload = {
        household_id: householdId,
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        headcount_expected: headcountExpected,
        notes,
        birthday_child_name: birthdayChildName,
        birthday_age: birthdayAge,
        occasion_details: occasionDetails,
        status: 'early_access_hold',
        status_updated_at: new Date().toISOString(),
        price_quote_cents: PARTY_TOTAL_FEE_CENTS,
        created_by_user_id: user.id,
        created_by_role: 'customer',
      };

      if (existingSameSlot) {
        const updateExisting = await supa
          .from('party_bookings')
          .update(holdPayload)
          .eq('id', existingSameSlot.id)
          .eq('household_id', householdId)
          .select('id')
          .maybeSingle();

        if (updateExisting.error) return Response.json({ ok: false, error: updateExisting.error.message }, { status: 500 });
        await notifyPartyBookingSaved({
          bookingId: updateExisting.data?.id ?? existingSameSlot.id,
          startTime: holdPayload.start_time,
          endTime: holdPayload.end_time,
          status: 'early_access_hold',
        });
        return Response.json({ ok: true, id: updateExisting.data?.id ?? existingSameSlot.id, status: 'early_access_hold', deposit_required_now: false });
      }

      const hold = await supa
        .from('party_bookings')
        .insert(holdPayload)
        .select('id')
        .maybeSingle();

      if (hold.error) return Response.json({ ok: false, error: hold.error.message }, { status: 500 });
      await notifyPartyBookingSaved({
        bookingId: hold.data?.id ?? null,
        startTime: holdPayload.start_time,
        endTime: holdPayload.end_time,
        status: 'early_access_hold',
      });
      return Response.json({ ok: true, id: hold.data?.id ?? null, status: 'early_access_hold', deposit_required_now: false });
    }

    if (mode === 'create_payment_link') {
      if (!process.env.SQUARE_ACCESS_TOKEN || !process.env.SQUARE_LOCATION_ID) {
        return Response.json({ ok: false, error: 'Square payment is not configured' }, { status: 500 });
      }

      const idempotencyKey = crypto.randomUUID();
      const reference = crypto.createHash('sha1').update(`${householdId}:${start.toISOString()}`).digest('hex').slice(0, 20);
      const base = process.env.NEXT_PUBLIC_BASE_URL || new URL(req.url).origin;
      const encodedStart = encodeURIComponent(start.toISOString());
      const encodedEnd = encodeURIComponent(end.toISOString());
      const encodedHeadcount = encodeURIComponent(String(headcountExpected ?? ''));
      const encodedNotes = encodeURIComponent(notes ?? '');
      const encodedSlot = encodeURIComponent(slot ?? '');
      const encodedBirthdayName = encodeURIComponent(birthdayChildName ?? '');
      const encodedBirthdayAge = encodeURIComponent(birthdayAge == null ? '' : String(birthdayAge));
      const encodedOccasion = encodeURIComponent(occasionDetails ?? '');
      const redirectUrl = `${base}/landing/party?party_checkout=success&start_time=${encodedStart}&end_time=${encodedEnd}&headcount_expected=${encodedHeadcount}&notes=${encodedNotes}&slot=${encodedSlot}&birthday_child_name=${encodedBirthdayName}&birthday_age=${encodedBirthdayAge}&occasion_details=${encodedOccasion}`;

      const squareBody = {
        idempotency_key: idempotencyKey,
        quick_pay: {
          name: 'Little Wanderers Party Deposit (50%)',
          price_money: {
            amount: PARTY_DEPOSIT_CENTS,
            currency: 'USD',
          },
          location_id: process.env.SQUARE_LOCATION_ID,
        },
        checkout_options: {
          redirect_url: redirectUrl,
          ask_for_shipping_address: false,
        },
        ...(buildPrePopulatedData(user.email) ? { pre_populated_data: buildPrePopulatedData(user.email) } : {}),
        reference_id: `pb_${reference}`,
        note: JSON.stringify({
          party_type: 'party_booking',
          birthday_child_name: birthdayChildName,
          birthday_age: birthdayAge,
          occasion_details: occasionDetails,
        }),
      };

      logSquarePayload('party checkout payload', squareBody as Record<string, unknown>);

      const resp = await fetch(`${getSquareBaseUrl()}/v2/online-checkout/payment-links`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.SQUARE_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
          'Square-Version': '2025-10-16',
        },
        body: JSON.stringify(squareBody),
      });

      if (!resp.ok) {
        const text = await resp.text();
        return Response.json({ ok: false, error: `square_error: ${text}` }, { status: 500 });
      }

      const data = await resp.json();
      const url: string | undefined = data?.payment_link?.url;
      if (!url) return Response.json({ ok: false, error: 'no_url_returned' }, { status: 500 });

      if (!existingSameSlot) {
        const pendingInsert = await supa.from('party_bookings').insert({
          household_id: householdId,
          start_time: start.toISOString(),
          end_time: end.toISOString(),
          headcount_expected: headcountExpected,
          notes,
          birthday_child_name: birthdayChildName,
          birthday_age: birthdayAge,
          occasion_details: occasionDetails,
          status: 'pending',
          status_updated_at: new Date().toISOString(),
          price_quote_cents: PARTY_TOTAL_FEE_CENTS,
          created_by_user_id: user.id,
          created_by_role: 'customer',
        });
        if (pendingInsert.error && isMissingColumnError(pendingInsert.error.message)) {
          const pendingFallback = await supa.from('party_bookings').insert({
            household_id: householdId,
            start_time: start.toISOString(),
            end_time: end.toISOString(),
            headcount_expected: headcountExpected,
            notes,
            price_quote_cents: PARTY_TOTAL_FEE_CENTS,
            created_by_user_id: user.id,
            created_by_role: 'customer',
          });
          if (pendingFallback.error) {
            console.warn('party pending fallback insert failed', pendingFallback.error.message);
          }
        } else if (pendingInsert.error) {
          console.warn('party pending insert failed', pendingInsert.error.message);
        }
      }

      return Response.json({ ok: true, payment_url: url, deposit_cents: PARTY_DEPOSIT_CENTS });
    }

    if (bookingId) {
      const primaryUpdate = await supa.from('party_bookings').update({
        headcount_expected: headcountExpected,
        notes,
        birthday_child_name: birthdayChildName,
        birthday_age: birthdayAge,
        occasion_details: occasionDetails,
        status: 'confirmed',
        status_updated_at: new Date().toISOString(),
      }).eq('id', bookingId).eq('household_id', householdId).select('id').maybeSingle();
      if (!primaryUpdate.error && primaryUpdate.data?.id) {
        await notifyPartyBookingSaved({
          bookingId: primaryUpdate.data.id,
          startTime: start.toISOString(),
          endTime: end.toISOString(),
          status: 'confirmed',
        });
        return Response.json({ ok: true, id: primaryUpdate.data.id, status: 'confirmed', deposit_paid_cents: PARTY_DEPOSIT_CENTS });
      }
    }

    const insertPayload = {
      household_id: householdId,
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      headcount_expected: headcountExpected,
      notes,
      birthday_child_name: birthdayChildName,
      birthday_age: birthdayAge,
      occasion_details: occasionDetails,
      status: 'confirmed',
      status_updated_at: new Date().toISOString(),
      price_quote_cents: PARTY_TOTAL_FEE_CENTS,
      created_by_user_id: user.id,
      created_by_role: 'customer',
    };

    const primary = await supa.from('party_bookings').insert(insertPayload).select('id').maybeSingle();

    if (primary.error && !isMissingColumnError(primary.error.message)) {
      return Response.json({ ok: false, error: primary.error.message }, { status: 500 });
    }

    if (primary.error) {
      const fallback = await supa
        .from('party_bookings')
        .insert({
          household_id: householdId,
          start_time: start.toISOString(),
          end_time: end.toISOString(),
          headcount_expected: headcountExpected,
          notes,
          price_quote_cents: PARTY_TOTAL_FEE_CENTS,
          created_by_user_id: user.id,
          created_by_role: 'customer',
        })
        .select('id')
        .maybeSingle();

      if (fallback.error) return Response.json({ ok: false, error: fallback.error.message }, { status: 500 });
      await notifyPartyBookingSaved({
        bookingId: fallback.data?.id ?? null,
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        status: 'confirmed',
      });
      return Response.json({ ok: true, id: fallback.data?.id ?? null, status: 'confirmed', deposit_paid_cents: PARTY_DEPOSIT_CENTS });
    }

    await notifyPartyBookingSaved({
      bookingId: primary.data?.id ?? null,
      startTime: insertPayload.start_time,
      endTime: insertPayload.end_time,
      status: 'confirmed',
    });
    return Response.json({ ok: true, id: primary.data?.id ?? null, status: 'confirmed', deposit_paid_cents: PARTY_DEPOSIT_CENTS });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'unknown error';
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
