import type { SupabaseClient } from '@supabase/supabase-js';
import { requireStaffContext } from '@/lib/authz';

const CLASS_SELECT = 'id,title,category,start_time,end_time,duration_minutes,instructor_name,description,capacity,price_cents,status,created_at,updated_at';
const CLASS_SELECT_FALLBACK = 'id,title,category,start_time,end_time,capacity,price_cents,status,created_at,updated_at';

type ClassRow = {
  id: string;
  title: string;
  category: string | null;
  start_time: string;
  end_time: string;
  duration_minutes?: number | null;
  instructor_name?: string | null;
  description?: string | null;
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
  let countsByClass = new Map<string, number>();

  if (ids.length > 0) {
    const { data: regs, error: regErr } = await admin.from('class_registrations').select('class_id,status').in('class_id', ids);
    if (regErr) throw new Error(regErr.message);

    countsByClass = (regs ?? []).reduce((map, row) => {
      if (row.status !== 'cancelled') {
        map.set(row.class_id, (map.get(row.class_id) ?? 0) + 1);
      }
      return map;
    }, new Map<string, number>());
  }

  return classes.map((item) => {
    const booked = countsByClass.get(item.id) ?? 0;
    return {
      ...item,
      duration_minutes: item.duration_minutes ?? Math.max(Math.round((new Date(item.end_time).getTime() - new Date(item.start_time).getTime()) / 60_000), 1),
      instructor_name: item.instructor_name ?? null,
      description: item.description ?? null,
      booked_count: booked,
      seats_left: item.capacity == null ? null : Math.max(item.capacity - booked, 0),
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
