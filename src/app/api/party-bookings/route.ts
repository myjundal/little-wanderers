import { createClient } from '@supabase/supabase-js';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getLatestHouseholdIdForUser } from '@/lib/households';
import crypto from 'crypto';
import { buildPrePopulatedData, logSquarePayload } from '@/lib/square';

export const dynamic = 'force-dynamic';
const NO_STORE_HEADERS = { 'cache-control': 'no-store, max-age=0' };

const PARTY_SELECT = 'id,start_time,end_time,headcount_expected,price_quote_cents,notes,status,status_updated_at,created_at';
const PARTY_SELECT_FALLBACK = 'id,start_time,end_time,headcount_expected,price_quote_cents,notes,created_at';

const PARTY_TOTAL_FEE_CENTS = 30000;
const PARTY_DEPOSIT_CENTS = 15000;

type PartyPayload = {
  start_time?: string;
  end_time?: string;
  headcount_expected?: number | null;
  notes?: string | null;
  slot?: '11:00' | '15:00';
  mode?: 'create_payment_link' | 'finalize';
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

function isWeekendSlot(start: Date, end: Date, slot?: string) {
  const day = start.getUTCDay();
  const isWeekend = day === 0 || day === 6;
  const durationHours = (end.getTime() - start.getTime()) / 3_600_000;
  const validSlot = slot === '11:00' || slot === '15:00';
  return isWeekend && validSlot && durationHours === 3;
}

async function getHouseholdIdForUser(userId: string) {
  return getLatestHouseholdIdForUser(admin(), userId);
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
    status: 'confirmed',
    status_updated_at: item.created_at,
  }));
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
    const mode = body.mode ?? 'create_payment_link';

    if (!startTime || !endTime) {
      return Response.json({ ok: false, error: 'start_time and end_time are required' }, { status: 400 });
    }

    const start = new Date(startTime);
    const end = new Date(endTime);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      return Response.json({ ok: false, error: 'invalid time range' }, { status: 400 });
    }

    if (!isWeekendSlot(start, end, slot)) {
      return Response.json({ ok: false, error: 'Party bookings are only available on Saturday/Sunday at 11:00 AM or 3:00 PM.' }, { status: 400 });
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

    if (existingSameSlot) {
      return Response.json({ ok: true, id: existingSameSlot.id, status: 'confirmed', deposit_paid_cents: PARTY_DEPOSIT_CENTS, deduplicated: true });
    }

    const { data: conflicts, error: conflictErr } = await supa
      .from('party_bookings')
      .select('id,start_time,end_time,status')
      .lt('start_time', end.toISOString())
      .gt('end_time', start.toISOString())
      .neq('status', 'cancelled');

    if (conflictErr) return Response.json({ ok: false, error: conflictErr.message }, { status: 500 });
    if ((conflicts ?? []).length > 0) {
      return Response.json({ ok: false, error: 'That party slot is already booked.' }, { status: 409 });
    }

    if (mode === 'create_payment_link') {
      if (!process.env.SQUARE_ACCESS_TOKEN || !process.env.SQUARE_LOCATION_ID) {
        return Response.json({ ok: false, error: 'Square payment is not configured' }, { status: 500 });
      }

      const idempotencyKey = crypto.randomUUID();
      const reference = crypto.createHash('sha1').update(`${householdId}:${start.toISOString()}`).digest('hex').slice(0, 20);
      const base = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
      const encodedStart = encodeURIComponent(start.toISOString());
      const encodedEnd = encodeURIComponent(end.toISOString());
      const encodedHeadcount = encodeURIComponent(String(headcountExpected ?? ''));
      const encodedNotes = encodeURIComponent(notes ?? '');
      const encodedSlot = encodeURIComponent(slot ?? '');
      const redirectUrl = `${base}/landing/party?party_checkout=success&start_time=${encodedStart}&end_time=${encodedEnd}&headcount_expected=${encodedHeadcount}&notes=${encodedNotes}&slot=${encodedSlot}`;

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

      return Response.json({ ok: true, payment_url: url, deposit_cents: PARTY_DEPOSIT_CENTS });
    }

    const insertPayload = {
      household_id: householdId,
      child_id: null,
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      headcount_expected: headcountExpected,
      notes,
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
          child_id: null,
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
      return Response.json({ ok: true, id: fallback.data?.id ?? null, status: 'confirmed', deposit_paid_cents: PARTY_DEPOSIT_CENTS });
    }

    return Response.json({ ok: true, id: primary.data?.id ?? null, status: 'confirmed', deposit_paid_cents: PARTY_DEPOSIT_CENTS });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'unknown error';
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
