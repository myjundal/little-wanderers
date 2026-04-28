import type { SupabaseClient } from '@supabase/supabase-js';
import { requireStaffContext } from '@/lib/authz';

export const dynamic = 'force-dynamic';

const CLASS_SELECT = 'id,title,category,start_time,end_time,duration_minutes,instructor_name,description,age_range,capacity,price_cents,status,created_at,updated_at';
const CLASS_SELECT_FALLBACK = 'id,title,category,start_time,end_time,capacity,price_cents,status,created_at,updated_at';

type AttendanceStatus = 'unknown' | 'attended' | 'cancelled' | 'no_show';

type ClassRow = {
  id: string;
  title: string;
  category: string | null;
  start_time: string;
  end_time: string;
  duration_minutes?: number | null;
  instructor_name?: string | null;
  description?: string | null;
  age_range?: string | null;
  capacity: number | null;
  price_cents: number;
  status: string;
};

function normalizeOptionalText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function isMissingColumnError(message: string) {
  return /column .* does not exist|Could not find the '.*' column/i.test(message);
}

function parseClassPayload(body: Record<string, unknown>) {
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const category = normalizeOptionalText(body.category);
  const instructor_name = normalizeOptionalText(body.instructor_name);
  const description = normalizeOptionalText(body.description);
  const age_range = normalizeOptionalText(body.age_range);
  const start_time = typeof body.start_time === 'string' ? body.start_time : '';
  const end_time = typeof body.end_time === 'string' ? body.end_time : '';
  const capacity = body.capacity == null || body.capacity === '' ? null : Number(body.capacity);
  const price_cents = body.price_cents == null || body.price_cents === '' ? 0 : Number(body.price_cents);

  const start = new Date(start_time);
  const end = new Date(end_time);

  if (!title) return { error: 'class title is required' } as const;
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    return { error: 'start time and end time must form a valid range' } as const;
  }
  if (capacity != null && (!Number.isInteger(capacity) || capacity < 0)) {
    return { error: 'capacity must be a whole number greater than or equal to 0' } as const;
  }
  if (!Number.isFinite(price_cents) || price_cents < 0) {
    return { error: 'price must be greater than or equal to 0' } as const;
  }

  const baseData = {
    title,
    category,
    start_time: start.toISOString(),
    end_time: end.toISOString(),
    capacity,
    price_cents: Math.round(price_cents),
    status: 'scheduled',
  };

  return {
    data: {
      ...baseData,
      duration_minutes: Math.max(Math.round((end.getTime() - start.getTime()) / 60_000), 1),
      instructor_name,
      description,
      age_range,
    },
    fallbackData: baseData,
  } as const;
}

async function selectClasses(admin: SupabaseClient) {
  const primary = await admin.from('classes').select(CLASS_SELECT).order('start_time', { ascending: true });
  if (!primary.error) return primary.data as ClassRow[];
  if (!isMissingColumnError(primary.error.message)) throw new Error(primary.error.message);

  const fallback = await admin.from('classes').select(CLASS_SELECT_FALLBACK).order('start_time', { ascending: true });
  if (fallback.error) throw new Error(fallback.error.message);
  return (fallback.data ?? []) as ClassRow[];
}

async function loadClasses(admin: SupabaseClient) {
  const classes = await selectClasses(admin);
  const ids = classes.map((item) => item.id);

  let regs: {
    id: string;
    class_id: string;
    person_id: string;
    status: string;
    attendance_status?: AttendanceStatus;
    attendance_marked_at?: string | null;
    attendance_marked_by?: string | null;
  }[] = [];

  if (ids.length > 0) {
    const primaryRegs = await admin
      .from('class_registrations')
      .select('id,class_id,person_id,status,attendance_status,attendance_marked_at,attendance_marked_by')
      .in('class_id', ids);

    if (primaryRegs.error && !isMissingColumnError(primaryRegs.error.message)) {
      throw new Error(primaryRegs.error.message);
    }

    if (primaryRegs.error) {
      const fallbackRegs = await admin.from('class_registrations').select('id,class_id,person_id,status').in('class_id', ids);
      if (fallbackRegs.error) throw new Error(fallbackRegs.error.message);
      regs = (fallbackRegs.data ?? []).map((row) => ({ ...row, attendance_status: 'unknown' }));
    } else {
      regs = primaryRegs.data ?? [];
    }
  }

  const personIds = [...new Set(regs.map((row) => row.person_id))];
  let people = new Map<string, { first_name: string | null; last_name: string | null; household_id: string | null }>();

  if (personIds.length > 0) {
    const { data: peopleRows, error: peopleErr } = await admin
      .from('people')
      .select('id,first_name,last_name,household_id')
      .in('id', personIds);
    if (peopleErr) throw new Error(peopleErr.message);

    people = new Map((peopleRows ?? []).map((row) => [row.id, row]));
  }

  const bookedCounts = new Map<string, number>();
  const registrantsByClass = new Map<string, Array<Record<string, unknown>>>();

  regs.forEach((row) => {
    if (row.status !== 'cancelled') {
      bookedCounts.set(row.class_id, (bookedCounts.get(row.class_id) ?? 0) + 1);
    }

    const person = people.get(row.person_id);
    const list = registrantsByClass.get(row.class_id) ?? [];
    list.push({
      registration_id: row.id,
      person_id: row.person_id,
      person_name: `${person?.first_name ?? ''} ${person?.last_name ?? ''}`.trim() || 'Unknown',
      household_id: person?.household_id ?? null,
      registration_status: row.status,
      attendance_status: row.attendance_status ?? 'unknown',
      attendance_marked_at: row.attendance_marked_at ?? null,
      attendance_marked_by: row.attendance_marked_by ?? null,
    });
    registrantsByClass.set(row.class_id, list);
  });

  return classes.map((item) => {
    const booked = bookedCounts.get(item.id) ?? 0;
    const registrants = (registrantsByClass.get(item.id) ?? []).sort((a, b) =>
      String(a.person_name).localeCompare(String(b.person_name))
    );

    return {
      ...item,
      duration_minutes:
        item.duration_minutes ??
        Math.max(Math.round((new Date(item.end_time).getTime() - new Date(item.start_time).getTime()) / 60_000), 1),
      instructor_name: item.instructor_name ?? null,
      description: item.description ?? null,
      age_range: item.age_range ?? null,
      booked_count: booked,
      seats_left: item.capacity == null ? null : Math.max(item.capacity - booked, 0),
      registrants,
    };
  });
}

async function insertClass(admin: SupabaseClient, payload: ReturnType<typeof parseClassPayload> & { error?: never }) {
  const primary = await admin.from('classes').insert(payload.data);
  if (!primary.error) return;
  if (!isMissingColumnError(primary.error.message)) throw new Error(primary.error.message);

  const fallback = await admin.from('classes').insert(payload.fallbackData);
  if (fallback.error) throw new Error(fallback.error.message);
}

export async function GET() {
  const context = await requireStaffContext();
  if (!context.ok) return context.response;

  try {
    const items = await loadClasses(context.admin);
    return Response.json({ ok: true, items });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'unknown error';
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const context = await requireStaffContext();
  if (!context.ok) return context.response;

  try {
    const parsed = parseClassPayload((await req.json()) as Record<string, unknown>);
    if ('error' in parsed) return Response.json({ ok: false, error: parsed.error }, { status: 400 });

    await insertClass(context.admin, parsed);
    const items = await loadClasses(context.admin);
    return Response.json({ ok: true, items });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'unknown error';
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
