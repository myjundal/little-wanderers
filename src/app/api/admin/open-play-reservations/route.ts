import { requireStaffContext } from '@/lib/authz';
import {
  formatOpenPlayReservationError,
  isMissingOpenPlayReservationTable,
  OPEN_PLAY_RESERVATION_SELECT,
  OPEN_PLAY_SLOT_SELECT,
  sanitizeReservationCount,
} from '@/lib/open-play-reservations';

export const dynamic = 'force-dynamic';

const NO_STORE_HEADERS = { 'cache-control': 'no-store, max-age=0' };

type SlotPayload = {
  label?: string;
  starts_at?: string;
  ends_at?: string;
  capacity_children?: number;
  capacity_total?: number | null;
  status?: string;
  notes?: string | null;
};

type SlotStatusPayload = {
  action?: 'update_slots';
  status?: string;
  date?: string;
  start_date?: string;
  end_date?: string;
  starts_at?: string;
  ends_at?: string;
  window_start?: string;
  window_end?: string;
};

function normalizeSlotStatus(input: unknown) {
  const value = typeof input === 'string' ? input : 'open';
  return ['open', 'hidden', 'closed'].includes(value) ? value : 'open';
}

function easternTimeKey(iso: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(iso));

  const hour = parts.find((part) => part.type === 'hour')?.value ?? '00';
  const minute = parts.find((part) => part.type === 'minute')?.value ?? '00';
  return `${hour}:${minute}`;
}

export async function GET() {
  const context = await requireStaffContext();
  if (!context.ok) return context.response;

  try {
    const [slotsRes, reservationsRes] = await Promise.all([
      context.admin
        .from('open_play_reservation_slots')
        .select(OPEN_PLAY_SLOT_SELECT)
        .eq('is_soft_opening', true)
        .order('starts_at', { ascending: true }),
      context.admin
        .from('open_play_reservations')
        .select(`${OPEN_PLAY_RESERVATION_SELECT}, slot:open_play_reservation_slots(${OPEN_PLAY_SLOT_SELECT})`)
        .order('created_at', { ascending: false }),
    ]);

    if (slotsRes.error) throw new Error(slotsRes.error.message);
    if (reservationsRes.error) throw new Error(reservationsRes.error.message);

    const householdIds = [...new Set((reservationsRes.data ?? []).map((item) => item.household_id as string).filter(Boolean))];
    const peopleByHousehold = new Map<string, string[]>();
    let householdsById = new Map<string, { name: string | null; email: string | null; phone: string | null }>();

    if (householdIds.length > 0) {
      const [householdsRes, peopleRes] = await Promise.all([
        context.admin.from('households').select('id,name,email,phone').in('id', householdIds),
        context.admin.from('people').select('household_id,first_name,last_name,role').in('household_id', householdIds).order('created_at', { ascending: true }),
      ]);

      if (householdsRes.error) throw new Error(householdsRes.error.message);
      if (peopleRes.error) throw new Error(peopleRes.error.message);

      householdsById = new Map((householdsRes.data ?? []).map((item) => [item.id as string, {
        name: item.name as string | null,
        email: item.email as string | null,
        phone: item.phone as string | null,
      }]));

      (peopleRes.data ?? []).forEach((person) => {
        const householdId = person.household_id as string;
        const name = [person.first_name, person.last_name].filter(Boolean).join(' ').trim();
        if (!name) return;
        const current = peopleByHousehold.get(householdId) ?? [];
        current.push(`${name}${person.role === 'child' ? ' (child)' : person.role === 'adult' ? ' (adult)' : ''}`);
        peopleByHousehold.set(householdId, current);
      });
    }

    const reservations = (reservationsRes.data ?? []).map((reservation) => {
      const household = householdsById.get(reservation.household_id as string) ?? null;
      return {
        ...reservation,
        household_name: household?.name ?? null,
        household_email: household?.email ?? null,
        household_phone: household?.phone ?? null,
        people: peopleByHousehold.get(reservation.household_id as string) ?? [],
      };
    });

    return Response.json({ ok: true, slots: slotsRes.data ?? [], reservations }, { headers: NO_STORE_HEADERS });
  } catch (e: unknown) {
    const rawMessage = e instanceof Error ? e.message : 'unknown error';
    const status = isMissingOpenPlayReservationTable(rawMessage) ? 503 : 500;
    return Response.json({ ok: false, error: formatOpenPlayReservationError(rawMessage) }, { status, headers: NO_STORE_HEADERS });
  }
}

export async function POST(req: Request) {
  const context = await requireStaffContext();
  if (!context.ok) return context.response;

  try {
    const body = (await req.json().catch(() => null)) as SlotPayload | null;
    const label = typeof body?.label === 'string' && body.label.trim() ? body.label.trim().slice(0, 80) : 'Soft Opening Open Play';
    const startsAt = typeof body?.starts_at === 'string' ? body.starts_at : '';
    const endsAt = typeof body?.ends_at === 'string' ? body.ends_at : '';
    const start = new Date(startsAt);
    const end = new Date(endsAt);

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      return Response.json({ ok: false, error: 'Choose a valid start and end time.' }, { status: 400, headers: NO_STORE_HEADERS });
    }

    const capacityChildren = sanitizeReservationCount(body?.capacity_children, 10, 200);
    const capacityTotal = body?.capacity_total == null ? null : sanitizeReservationCount(body.capacity_total, capacityChildren * 2, 400);
    const notes = typeof body?.notes === 'string' && body.notes.trim() ? body.notes.trim().slice(0, 500) : null;

    const { data, error } = await context.admin
      .from('open_play_reservation_slots')
      .insert({
        label,
        starts_at: start.toISOString(),
        ends_at: end.toISOString(),
        capacity_children: capacityChildren,
        capacity_total: capacityTotal,
        status: normalizeSlotStatus(body?.status),
        notes,
        is_soft_opening: true,
        created_by_user_id: context.user.id,
      })
      .select(OPEN_PLAY_SLOT_SELECT)
      .maybeSingle();

    if (error) throw new Error(error.message);

    return Response.json({ ok: true, slot: data }, { headers: NO_STORE_HEADERS });
  } catch (e: unknown) {
    const rawMessage = e instanceof Error ? e.message : 'unknown error';
    const status = isMissingOpenPlayReservationTable(rawMessage) ? 503 : 500;
    return Response.json({ ok: false, error: formatOpenPlayReservationError(rawMessage) }, { status, headers: NO_STORE_HEADERS });
  }
}

export async function PATCH(req: Request) {
  const context = await requireStaffContext();
  if (!context.ok) return context.response;

  try {
    const body = (await req.json().catch(() => null)) as SlotStatusPayload | null;
    if (body?.action !== 'update_slots') {
      return Response.json({ ok: false, error: 'invalid action' }, { status: 400, headers: NO_STORE_HEADERS });
    }

    const nextStatus = normalizeSlotStatus(body.status);
    let start: Date | null = null;
    let end: Date | null = null;

    if (body.starts_at && body.ends_at) {
      start = new Date(body.starts_at);
      end = new Date(body.ends_at);
    } else if (body.date) {
      start = new Date(`${body.date}T00:00:00`);
      end = new Date(`${body.date}T00:00:00`);
      end.setDate(end.getDate() + 1);
    } else if (body.start_date && body.end_date) {
      start = new Date(`${body.start_date}T00:00:00`);
      end = new Date(`${body.end_date}T00:00:00`);
      end.setDate(end.getDate() + 1);
    }

    if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      return Response.json({ ok: false, error: 'Choose a valid date range.' }, { status: 400, headers: NO_STORE_HEADERS });
    }

    let query = context.admin
      .from('open_play_reservation_slots')
      .select('id,starts_at,ends_at')
      .eq('is_soft_opening', true)
      .gte('starts_at', start.toISOString())
      .lt('starts_at', end.toISOString());

    if (body.window_start && body.window_end) {
      query = query.order('starts_at', { ascending: true });
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    const matchingIds = (data ?? [])
      .filter((slot) => {
        if (!body.window_start || !body.window_end) return true;
        return easternTimeKey(slot.starts_at as string) === body.window_start && easternTimeKey(slot.ends_at as string) === body.window_end;
      })
      .map((slot) => slot.id as string);

    if (matchingIds.length === 0) {
      return Response.json({ ok: true, updated_count: 0 }, { headers: NO_STORE_HEADERS });
    }

    const { error: updateError } = await context.admin
      .from('open_play_reservation_slots')
      .update({ status: nextStatus })
      .in('id', matchingIds);

    if (updateError) throw new Error(updateError.message);

    return Response.json({ ok: true, updated_count: matchingIds.length }, { headers: NO_STORE_HEADERS });
  } catch (e: unknown) {
    const rawMessage = e instanceof Error ? e.message : 'unknown error';
    const status = isMissingOpenPlayReservationTable(rawMessage) ? 503 : 500;
    return Response.json({ ok: false, error: formatOpenPlayReservationError(rawMessage) }, { status, headers: NO_STORE_HEADERS });
  }
}
