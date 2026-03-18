import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const admin = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

function toInt(value: unknown, fallback: number) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export async function GET(req: NextRequest) {
  try {
    const limit = toInt(req.nextUrl.searchParams.get('limit'), 20);
    const supa = admin();

    const { data: classes, error: classErr } = await supa
      .from('classes')
      .select('id,title,category,start_time,end_time,duration_minutes,instructor_name,description,capacity,price_cents,status')
      .gte('start_time', new Date().toISOString())
      .eq('status', 'scheduled')
      .order('start_time', { ascending: true })
      .limit(limit);

    if (classErr) {
      return Response.json({ ok: false, error: classErr.message }, { status: 500 });
    }

    const ids = (classes ?? []).map((c) => c.id);
    let countsByClass = new Map<string, number>();

    if (ids.length > 0) {
      const { data: regs } = await supa
        .from('class_registrations')
        .select('class_id,status')
        .in('class_id', ids);

      countsByClass = (regs ?? []).reduce((map, row) => {
        if (row.status !== 'cancelled') {
          map.set(row.class_id, (map.get(row.class_id) ?? 0) + 1);
        }
        return map;
      }, new Map<string, number>());
    }

    const items = (classes ?? []).map((c) => {
      const booked = countsByClass.get(c.id) ?? 0;
      const seatsLeft = c.capacity == null ? null : Math.max(c.capacity - booked, 0);
      return {
        ...c,
        booked_count: booked,
        seats_left: seatsLeft,
      };
    });

    return Response.json({ ok: true, items });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'unknown error';
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
