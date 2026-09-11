import { NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getLatestHouseholdIdForUser } from '@/lib/households';
import {
  formatOpenPlayReservationError,
  getReservationOccupancy,
  isMissingOpenPlayReservationTable,
  isUuid,
  OPEN_PLAY_RESERVATION_SELECT,
  OPEN_PLAY_SLOT_SELECT,
  sanitizeReservationCount,
} from '@/lib/open-play-reservations';
import { getSoftOpeningAccessForUser } from '@/lib/soft-opening-access';

export const dynamic = 'force-dynamic';

const NO_STORE_HEADERS = { 'cache-control': 'no-store, max-age=0' };

type ReservationPayload = {
  slot_id?: string;
  child_count?: number;
  adult_count?: number;
  notes?: string | null;
};

const SOFT_OPENING_START = '2026-10-15T00:00:00-04:00';
const SOFT_OPENING_END = '2026-11-01T00:00:00-04:00';

async function getCurrentReservationContext() {
  const server = createServerSupabaseClient();
  const {
    data: { user },
  } = await server.auth.getUser();

  if (!user) {
    return { ok: false as const, response: NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401, headers: NO_STORE_HEADERS }) };
  }

  const admin = createAdminSupabaseClient();
  const access = await getSoftOpeningAccessForUser(admin, user);
  if (!access.allowed) {
    return { ok: false as const, response: NextResponse.json({ ok: false, allowed: false, error: 'Soft opening reservations are currently reserved for Wanderlist and party early access families.' }, { status: 403, headers: NO_STORE_HEADERS }) };
  }

  const householdId = await getLatestHouseholdIdForUser(admin, user.id);
  if (!householdId) {
    return { ok: false as const, response: NextResponse.json({ ok: false, error: 'Please finish setting up your family profile before reserving.' }, { status: 404, headers: NO_STORE_HEADERS }) };
  }

  return { ok: true as const, admin, user, access, householdId };
}

export async function GET() {
  try {
    const context = await getCurrentReservationContext();
    if (!context.ok) return context.response;

    const [slotsRes, reservationsRes] = await Promise.all([
      context.admin
        .from('open_play_reservation_slots')
        .select(OPEN_PLAY_SLOT_SELECT)
        .eq('is_soft_opening', true)
        .neq('status', 'hidden')
        .gte('starts_at', SOFT_OPENING_START)
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
    const activeReservations = reservations.filter((item) => item.status !== 'cancelled');
    const activeSlotIds = new Set(activeReservations.map((item) => item.slot_id as string));

    const occupancyBySlot = new Map<string, { children: number; adults: number; total: number }>();
    if ((slotsRes.data ?? []).length > 0) {
      const slotIds = (slotsRes.data ?? []).map((slot) => slot.id as string);
      const { data: occupancyRows, error: occupancyError } = await context.admin
        .from('open_play_reservations')
        .select('slot_id,child_count,adult_count,status')
        .in('slot_id', slotIds)
        .neq('status', 'cancelled');

      if (occupancyError) throw new Error(occupancyError.message);

      (occupancyRows ?? []).forEach((row) => {
        const slotId = row.slot_id as string;
        const current = occupancyBySlot.get(slotId) ?? { children: 0, adults: 0, total: 0 };
        current.children += Number(row.child_count ?? 0);
        current.adults += Number(row.adult_count ?? 0);
        current.total += Number(row.child_count ?? 0) + Number(row.adult_count ?? 0);
        occupancyBySlot.set(slotId, current);
      });
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
        is_closed: slot.status === 'closed',
        is_full: remainingChildren <= 0 || (remainingTotal != null && remainingTotal <= 0),
      };
    });

    return NextResponse.json({ ok: true, allowed: true, access: context.access, slots, reservations }, { headers: NO_STORE_HEADERS });
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

    const childCount = sanitizeReservationCount(body?.child_count, 1, 6);
    const adultCount = sanitizeReservationCount(body?.adult_count, 1, 2);
    const notes = typeof body?.notes === 'string' && body.notes.trim() ? body.notes.trim().slice(0, 500) : null;

    const { data: existingActive, error: existingActiveError } = await context.admin
      .from('open_play_reservations')
      .select('id')
      .eq('household_id', context.householdId)
      .neq('status', 'cancelled')
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
    if (slotStartMs < new Date(SOFT_OPENING_START).getTime() || slotStartMs >= new Date(SOFT_OPENING_END).getTime()) {
      return NextResponse.json({ ok: false, error: 'This visit time is outside the soft opening reservation window.' }, { status: 409, headers: NO_STORE_HEADERS });
    }
    if (new Date(slot.ends_at as string).getTime() <= Date.now()) {
      return NextResponse.json({ ok: false, error: 'This soft opening visit time has already passed.' }, { status: 409, headers: NO_STORE_HEADERS });
    }

    const occupancy = await getReservationOccupancy(context.admin, slotId);
    const nextChildren = occupancy.children + childCount;
    const nextTotal = occupancy.total + childCount + adultCount;
    const capacityChildren = Number(slot.capacity_children ?? 0);
    const capacityTotal = slot.capacity_total == null ? null : Number(slot.capacity_total);

    if (nextChildren > capacityChildren || (capacityTotal != null && nextTotal > capacityTotal)) {
      return NextResponse.json({ ok: false, error: 'This soft opening visit time is full. Please choose another time.' }, { status: 409, headers: NO_STORE_HEADERS });
    }

    const { data: reservation, error: reservationError } = await context.admin
      .from('open_play_reservations')
      .insert({
        slot_id: slotId,
        household_id: context.householdId,
        created_by_user_id: context.user.id,
        contact_email: context.user.email ?? null,
        child_count: childCount,
        adult_count: adultCount,
        notes,
        status: 'reserved',
        status_updated_at: new Date().toISOString(),
      })
      .select(OPEN_PLAY_RESERVATION_SELECT)
      .maybeSingle();

    if (reservationError) {
      if (reservationError.code === '23505') {
        return NextResponse.json({ ok: false, error: 'You already have a reservation for this visit time.' }, { status: 409, headers: NO_STORE_HEADERS });
      }
      throw new Error(reservationError.message);
    }

    return NextResponse.json({ ok: true, reservation }, { headers: NO_STORE_HEADERS });
  } catch (e: unknown) {
    const rawMessage = e instanceof Error ? e.message : 'unknown error';
    const status = isMissingOpenPlayReservationTable(rawMessage) ? 503 : 500;
    return NextResponse.json({ ok: false, error: formatOpenPlayReservationError(rawMessage) }, { status, headers: NO_STORE_HEADERS });
  }
}
