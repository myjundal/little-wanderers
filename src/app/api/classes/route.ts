import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const CLASS_SELECT = 'id,title,category,start_time,end_time,duration_minutes,instructor_name,description,capacity,price_cents,status';
const CLASS_SELECT_FALLBACK = 'id,title,category,start_time,end_time,capacity,price_cents,status';

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

const admin = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

function toInt(value: unknown, fallback: number) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function isMissingColumnError(message: string) {
  return /column .* does not exist|Could not find the '.*' column/i.test(message);
}

async function selectClasses(limit: number) {
  const supa = admin();
  const primary = await supa
    .from('classes')
    .select(CLASS_SELECT)
    .gte('start_time', new Date().toISOString())
    .eq('status', 'scheduled')
    .order('start_time', { ascending: true })
    .limit(limit);

  if (!primary.error) return (primary.data ?? []) as ClassRow[];
  if (!isMissingColumnError(primary.error.message)) throw new Error(primary.error.message);

  const fallback = await supa
    .from('classes')
    .select(CLASS_SELECT_FALLBACK)
    .gte('start_time', new Date().toISOString())
    .eq('status', 'scheduled')
    .order('start_time', { ascending: true })
    .limit(limit);

  if (fallback.error) throw new Error(fallback.error.message);
  return (fallback.data ?? []) as ClassRow[];
}

export async function GET(req: NextRequest) {
  try {
    const limit = toInt(req.nextUrl.searchParams.get('limit'), 20);
    const supa = admin();
    const classes = await selectClasses(limit);

    const ids = classes.map((c) => c.id);
    let countsByClass = new Map<string, number>();

    if (ids.length > 0) {
      const { data: regs } = await supa.from('class_registrations').select('class_id,status').in('class_id', ids);
      countsByClass = (regs ?? []).reduce((map, row) => {
        if (row.status !== 'cancelled') {
          map.set(row.class_id, (map.get(row.class_id) ?? 0) + 1);
        }
        return map;
      }, new Map<string, number>());
    }

    const items = classes.map((c) => {
      const booked = countsByClass.get(c.id) ?? 0;
      return {
        ...c,
        duration_minutes: c.duration_minutes ?? Math.max(Math.round((new Date(c.end_time).getTime() - new Date(c.start_time).getTime()) / 60_000), 1),
        instructor_name: c.instructor_name ?? null,
        description: c.description ?? null,
        booked_count: booked,
        seats_left: c.capacity == null ? null : Math.max(c.capacity - booked, 0),
      };
    });

    return Response.json({ ok: true, items });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'unknown error';
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
