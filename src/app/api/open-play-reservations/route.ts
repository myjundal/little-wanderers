import { waitUntil } from '@vercel/functions';
import { sendOpenPlayReservationNotification } from '@/lib/admin-notifications';
import { sendOpenPlayConfirmation } from '@/lib/open-play-confirmation';
import { readPrivatePartyDays, overlapsPrivateParty } from '@/lib/private-party-open-play';
import { getPartyDateKey } from '@/lib/party-config';
import { logger } from '@/lib/logger';
import { NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getLatestHouseholdIdForUser } from '@/lib/households';
import {
  SOFT_OPENING_START,
  PUBLIC_OPEN_PLAY_START,
  SOFT_OPENING_END,
  formatOpenPlayReservationError,
  getReservationOccupancy,
  isMissingOpenPlayReservationTable,
  isUuid,
  OPEN_PLAY_RESERVATION_SELECT,
  OPEN_PLAY_SLOT_SELECT,
  sanitizeReservationCount,
} from '@/lib/open-play-reservations';
import { readSoftOpeningFamily, saveSoftOpeningFamily, type SoftOpeningPersonInput } from '@/lib/soft-opening-family';
import { softOpeningAmount } from '@/lib/soft-opening-pricing';
import { getSoftOpeningAccessForUser } from '@/lib/soft-opening-access';

export const dynamic = 'force-dynamic';

const NO_STORE_HEADERS = { 'cache-control': 'no-store, max-age=0' };

type ReservationPayload = {
  slot_id?: string;
  booking_source?: string;
  child_count?: number;
  adult_count?: number;
  notes?: string | null;
  guardian_first_name?: string;
  guardian_last_name?: string;
  children?: SoftOpeningPersonInput[];
  payment_choice?: string;
};



async function getCurrentReservationContext() {
  const server = await createServerSupabaseClient();
  const {
    data: { user },
  } = await server.auth.getUser();

  if (!user) {
    return { ok: false as const, response: NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401, headers: NO_STORE_HEADERS }) };
  }

  const admin = createAdminSupabaseClient();
  const access = await getSoftOpeningAccessForUser(admin, user);
  if (!access.allowed) {
    return { ok: false as const, response: NextResponse.json({ ok: false, allowed: false, error: 'Please sign in or create a website account to reserve.' }, { status: 403, headers: NO_STORE_HEADERS }) };
  }

  const householdId = await getLatestHouseholdIdForUser(admin, user.id);
  if (!householdId) {
    return { ok: false as const, response: NextResponse.json({ ok: false, error: 'Please finish setting up your family profile before reserving.' }, { status: 404, headers: NO_STORE_HEADERS }) };
  }

  return { ok: true as const, admin, user, access, householdId };
}

export async function GET(req: Request) {
  try {
    const context = await getCurrentReservationContext();
    if (!context.ok) return context.response;

    const start = req && new URL(req.url).searchParams.get('source') === 'public' ? PUBLIC_OPEN_PLAY_START : SOFT_OPENING_START;
    const [slotsRes, reservationsRes] = await Promise.all([
      context.admin
        .from('open_play_reservation_slots')
        .select(OPEN_PLAY_SLOT_SELECT)
        .eq('is_soft_opening', true)
        .neq('status', 'hidden')
        .gte('starts_at', start)
        .lt('starts_at', SOFT_OPENING_END)
        .gte('ends_at', new Date().toISOString())
        .order('starts_at', { ascending: true }),
      context.admin
        .from('open_play_reservations')
        .select(`${OPEN_PLAY_RESERVATION_SELECT}, slot:open_play_reservation_slots(${OPEN_PLAY_SLOT_SELECT})`)
        .eq('household_id', context.householdId)
        .order('created_at', { ascending: false }),
    ]);

    if (slotsRes.error) throw new Error(slotsRes.error.message);
    if (reservationsRes.error) throw new Error(reservationsRes.error.message);

    const reservations = reservationsRes.data ?? [];
    const privatePartyDays = await readPrivatePartyDays(context.admin, [
      ...(slotsRes.data ?? []),
      ...reservations.flatMap(item => Array.isArray(item.slot) ? item.slot : item.slot ? [item.slot] : []),
    ]);
    const activeReservations = reservations.filter((item) => item.status !== 'cancelled');
    const activeSlotIds = new Set(activeReservations.map((item) => item.slot_id as string));

    const occupancyBySlot = new Map<string, { children: number; adults: number; total: number }>();
    if ((slotsRes.data ?? []).length > 0) {
      for (let offset = 0; ; offset += 500) {
        const { data: occupancyRows, error: occupancyError } = await context.admin
          .from('open_play_reservations')
          .select('slot_id,child_count,adult_count,status,slot:open_play_reservation_slots!inner(starts_at)')
          .gte('slot.starts_at', start).lt('slot.starts_at', SOFT_OPENING_END)
          .neq('status', 'cancelled').order('id').range(offset, offset + 499);

        if (occupancyError) throw new Error(occupancyError.message);

        (occupancyRows ?? []).forEach((row) => {
          const slotId = row.slot_id as string;
          const current = occupancyBySlot.get(slotId) ?? { children: 0, adults: 0, total: 0 };
          current.children += Number(row.child_count ?? 0);
          current.adults += Number(row.adult_count ?? 0);
          current.total += Number(row.child_count ?? 0) + Number(row.adult_count ?? 0);
          occupancyBySlot.set(slotId, current);
        });
        if ((occupancyRows?.length ?? 0) < 500) break;
      }
    }

    const slots = (slotsRes.data ?? []).map((slot) => {
      const occupancy = occupancyBySlot.get(slot.id as string) ?? { children: 0, adults: 0, total: 0 };
      const capacityChildren = Number(slot.capacity_children ?? 0);
      const capacityTotal = slot.capacity_total == null ? null : Number(slot.capacity_total);
      const remainingChildren = Math.max(0, capacityChildren - occupancy.children);
      const remainingTotal = capacityTotal == null ? null : Math.max(0, capacityTotal - occupancy.total);

      return {
        ...slot,
        reserved_by_household: activeSlotIds.has(slot.id as string),
        occupancy,
        remaining_children: remainingChildren,
        remaining_total: remainingTotal,
        is_closed: slot.status === 'closed' || overlapsPrivateParty(slot, privatePartyDays),
        is_private_party_blocked: overlapsPrivateParty(slot, privatePartyDays),
        is_full: remainingChildren <= 0 || (remainingTotal != null && remainingTotal <= 0),
      };
    });

    const family = await readSoftOpeningFamily(context.admin, context.householdId);
    return NextResponse.json({ ok: true, allowed: true, access: context.access, slots, reservations, family, private_party_days: privatePartyDays }, { headers: NO_STORE_HEADERS });
  } catch (e: unknown) {
    const rawMessage = e instanceof Error ? e.message : 'unknown error';
    const status = isMissingOpenPlayReservationTable(rawMessage) ? 503 : 500;
    return NextResponse.json({ ok: false, error: formatOpenPlayReservationError(rawMessage) }, { status, headers: NO_STORE_HEADERS });
  }
}

export async function POST(req: Request) {
  try {
    const context = await getCurrentReservationContext();
    if (!context.ok) return context.response;

    const body = (await req.json().catch(() => null)) as ReservationPayload | null;
    const slotId = String(body?.slot_id ?? '');
    if (!isUuid(slotId)) {
      return NextResponse.json({ ok: false, error: 'Choose a soft opening visit time.' }, { status: 400, headers: NO_STORE_HEADERS });
    }

    const childCount = Array.isArray(body?.children) ? body.children.length : 0;
    if (childCount < 1 || childCount > 5) return NextResponse.json({ok:false,error:"Choose 1–5 participating children."},{status:400});
    if (!["counter","now"].includes(body?.payment_choice ?? "")) return NextResponse.json({ok:false,error:"Choose how to pay."},{status:400});
    const adultCount = sanitizeReservationCount(body?.adult_count, 1, 2);
    const notes = typeof body?.notes === 'string' && body.notes.trim() ? body.notes.trim().slice(0, 500) : null;

    const { data: existingActive, error: existingActiveError } = await context.admin
      .from('open_play_reservations')
      .select('id,slot:open_play_reservation_slots!inner(ends_at)')
      .eq('household_id', context.householdId)
      .eq('status', 'reserved')
      .gt('slot.ends_at', new Date().toISOString())
      .limit(1)
      .maybeSingle();

    if (existingActiveError) throw new Error(existingActiveError.message);
    if (existingActive) {
      return NextResponse.json({ ok: false, error: 'You already have a soft opening reservation. Please cancel it before choosing another time.' }, { status: 409, headers: NO_STORE_HEADERS });
    }

    const { data: slot, error: slotError } = await context.admin
      .from('open_play_reservation_slots')
      .select(OPEN_PLAY_SLOT_SELECT)
      .eq('id', slotId)
      .eq('is_soft_opening', true)
      .maybeSingle();

    if (slotError) throw new Error(slotError.message);
    if (!slot) {
      return NextResponse.json({ ok: false, error: 'This soft opening visit time is no longer available.' }, { status: 404, headers: NO_STORE_HEADERS });
    }
    if (slot.status !== 'open') {
      return NextResponse.json({ ok: false, error: 'This soft opening visit time is not open for reservations.' }, { status: 409, headers: NO_STORE_HEADERS });
    }
    const slotStartMs = new Date(slot.starts_at as string).getTime();
    if (body?.booking_source === 'public' && slotStartMs < new Date(PUBLIC_OPEN_PLAY_START).getTime()) {
      return NextResponse.json({ ok: false, error: 'Public Open Play visits begin Saturday, November 14. Please choose November 14 or later.' }, { status: 409, headers: NO_STORE_HEADERS });
    }
    if (slotStartMs < new Date(SOFT_OPENING_START).getTime() || slotStartMs >= new Date(SOFT_OPENING_END).getTime()) {
      return NextResponse.json({ ok: false, error: 'This visit time is outside the soft opening reservation window.' }, { status: 409, headers: NO_STORE_HEADERS });
    }
    if (new Date(slot.ends_at as string).getTime() <= Date.now()) {
      return NextResponse.json({ ok: false, error: 'This soft opening visit time has already passed.' }, { status: 409, headers: NO_STORE_HEADERS });
    }

    const privatePartyDays = await readPrivatePartyDays(context.admin, [slot]);
    if (overlapsPrivateParty(slot, privatePartyDays)) {
      return NextResponse.json({ ok: false, error: 'Open Play is unavailable from 4–6 PM for a private party. Please choose another arrival window.', code: 'private_party' }, { status: 409, headers: NO_STORE_HEADERS });
    }
    const privateClosing = privatePartyDays.find(day => day.date === getPartyDateKey(slot.starts_at))?.starts_at;

    const occupancy = await getReservationOccupancy(context.admin, slotId);
    const nextChildren = occupancy.children + childCount;
    const nextTotal = occupancy.total + childCount + adultCount;
    const capacityChildren = Number(slot.capacity_children ?? 0);
    const capacityTotal = slot.capacity_total == null ? null : Number(slot.capacity_total);

    if (nextChildren > capacityChildren || (capacityTotal != null && nextTotal > capacityTotal)) {
      return NextResponse.json({ ok: false, error: 'This soft opening visit time is full. Please choose another time.' }, { status: 409, headers: NO_STORE_HEADERS });
    }

    let family;
    try { family = await saveSoftOpeningFamily(context.admin, context.householdId, context.user, body!); }
    catch (error) { return NextResponse.json({ok:false,error:error instanceof Error ? error.message : 'Complete your family details.'},{status:400}); }
    const visitDate = new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(slot.starts_at));
    const amount = softOpeningAmount(family.childIds, family.memberships, visitDate, family.children);

    const { data: reservation, error: reservationError } = await context.admin
      .from('open_play_reservations')
      .insert({
        slot_id: slotId,
        household_id: context.householdId,
        created_by_user_id: context.user.id,
        contact_email: context.user.email ?? null,
        child_count: childCount,
        child_ids: family.childIds,
        amount_cents: amount,
        payment_choice: amount === 0 ? "membership" : "counter",
        payment_status: amount === 0 ? "covered" : "due",
        adult_count: adultCount,
        notes,
        status: 'reserved',
        status_updated_at: new Date().toISOString(),
      })
      .select(OPEN_PLAY_RESERVATION_SELECT)
      .maybeSingle();

    if (reservationError) {
      if (reservationError.code === '23514') {
        return NextResponse.json({ ok: false, error: reservationError.message, code: /private party/i.test(reservationError.message) ? 'private_party' : undefined }, { status: 409, headers: NO_STORE_HEADERS });
      }
      if (reservationError.code === '23505') {
        return NextResponse.json({ ok: false, error: 'You already have a reservation for this visit time.' }, { status: 409, headers: NO_STORE_HEADERS });
      }
      throw new Error(reservationError.message);
    }

    if (!reservation) throw new Error('Unable to save your reservation.');
    // Send independently of the owner alert, after the reservation is committed.
    waitUntil((async () => {
      try {
        let email = reservation.contact_email || context.user.email || '';
        if (!email) {
          const contact = await context.admin.from('households').select('email')
            .eq('id', context.householdId).maybeSingle();
          if (contact.error) throw new Error('Unable to read reservation contact.');
          email = contact.data?.email || '';
        }
        const confirmation = await sendOpenPlayConfirmation({
          reservationId: reservation.id,
          email,
          guardianName: family.guardianName,
          childNames: family.children.map(child => child.name),
          childCount, adultCount,
          startTime: slot.starts_at, endTime: slot.ends_at,
          amountCents: reservation.amount_cents,
          closingTime: privateClosing,
          paymentStatus: reservation.payment_status,
          paymentChoice: reservation.payment_choice,
        });
        if (!confirmation.ok) logger.error({ action: 'open_play.customer_confirmation_failed', reservationId: reservation.id });
      } catch {
        logger.error({ action: 'open_play.customer_confirmation_failed', reservationId: reservation.id });
      }
    })());
    // A mail-provider outage must never make a saved reservation appear to fail.
    waitUntil((async () => {
      try {
        const { data: contact, error: contactError } = await context.admin.from('households')
          .select('email,phone').eq('id', context.householdId).maybeSingle();
        if (contactError) logger.warn({ action: 'open_play.notification_contact_lookup_failed', reservationId: reservation.id });
        const notification = await sendOpenPlayReservationNotification({
          reservationId: reservation.id, householdId: context.householdId,
          guardianName: family.guardianName, email: contact?.email || context.user.email, phone: contact?.phone || context.user.phone,
          children: family.children, startTime: slot.starts_at, endTime: slot.ends_at,
          adultCount, amountCents: amount, paymentChoice: body!.payment_choice!, notes,
        });
        if (!notification.ok) logger.error({ action: 'open_play.owner_notification_failed', reservationId: reservation.id });
      } catch {
        logger.error({ action: 'open_play.owner_notification_failed', reservationId: reservation.id });
      }
    })());
    return NextResponse.json({ ok: true, reservation, waiver_url: `/landing/waiver?reservation=${reservation.id}` }, { headers: NO_STORE_HEADERS });
  } catch (e: unknown) {
    const rawMessage = e instanceof Error ? e.message : 'unknown error';
    const status = isMissingOpenPlayReservationTable(rawMessage) ? 503 : 500;
    return NextResponse.json({ ok: false, error: formatOpenPlayReservationError(rawMessage) }, { status, headers: NO_STORE_HEADERS });
  }
}
