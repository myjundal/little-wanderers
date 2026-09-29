import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { countWaitlistRegistrations, hasActiveWaitlistOffer } from '@/lib/class-waitlist';

export const dynamic = 'force-dynamic';
const NO_STORE_HEADERS = { 'cache-control': 'no-store, max-age=0' };

const CLASS_SELECT = 'id,title,category,start_time,end_time,duration_minutes,instructor_name,description,age_range,caregiver_participation,schedule_note,schedule_label,capacity,price_cents,status';
const CLASS_SELECT_WITHOUT_DURATION = 'id,title,category,start_time,end_time,instructor_name,description,age_range,caregiver_participation,schedule_note,schedule_label,capacity,price_cents,status';

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
  caregiver_participation?: string | null;
  schedule_note?: string | null;
  schedule_label?: string | null;
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

function isMissingDurationColumn(message: string) {
  return /duration_minutes/i.test(message) && /column .* does not exist|Could not find the '.*' column/i.test(message);
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
  if (isMissingDurationColumn(primary.error.message)) {
    const fallback = await supa
      .from('classes')
      .select(CLASS_SELECT_WITHOUT_DURATION)
      .gte('start_time', new Date().toISOString())
      .eq('status', 'scheduled')
      .order('start_time', { ascending: true })
      .limit(limit);

    if (!fallback.error) return (fallback.data ?? []) as ClassRow[];
    throw new Error(fallback.error.message);
  }
  throw new Error(primary.error.message);
}

export async function GET(req: NextRequest) {
  try {
    const limit = toInt(req.nextUrl.searchParams.get('limit'), 200);
    const supa = admin();
    const classes = await selectClasses(limit);

    const ids = classes.map((c) => c.id);
    let countsByClass = new Map<string, number>();
    const registrationsByPerson = new Map<string, Set<string>>();

    if (ids.length > 0) {
      const { data: regs } = await supa.from('class_registrations').select('class_id,person_id,status').in('class_id', ids);
      countsByClass = (regs ?? []).reduce((map, row) => {
        if (row.status === 'scheduled' || row.status === 'attended') {
          map.set(row.class_id, (map.get(row.class_id) ?? 0) + 1);
          if (!registrationsByPerson.has(row.person_id)) {
            registrationsByPerson.set(row.person_id, new Set());
          }
          registrationsByPerson.get(row.person_id)!.add(row.class_id);
        }
        return map;
      }, new Map<string, number>());
    }

    const pairCounts = new Map<string, number>();
    registrationsByPerson.forEach((classSet) => {
      const classList = Array.from(classSet);
      for (let i = 0; i < classList.length; i += 1) {
        for (let j = i + 1; j < classList.length; j += 1) {
          const a = classList[i];
          const b = classList[j];
          const key = a < b ? `${a}::${b}` : `${b}::${a}`;
          pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
        }
      }
    });

    const sortedByPopularity = [...classes]
      .map((klass) => ({ id: klass.id, booked: countsByClass.get(klass.id) ?? 0 }))
      .sort((a, b) => b.booked - a.booked);
    const popularThreshold = sortedByPopularity[Math.floor(sortedByPopularity.length * 0.25) - 1]?.booked ?? 0;

    const items = await Promise.all(classes.map(async (c) => {
      const booked = countsByClass.get(c.id) ?? 0;
      const recommendations = classes
        .filter((candidate) => candidate.id !== c.id)
        .map((candidate) => {
          const key = c.id < candidate.id ? `${c.id}::${candidate.id}` : `${candidate.id}::${c.id}`;
          return { class_id: candidate.id, score: pairCounts.get(key) ?? 0 };
        })
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);

      return {
        ...c,
        duration_minutes: c.duration_minutes ?? Math.max(Math.round((new Date(c.end_time).getTime() - new Date(c.start_time).getTime()) / 60_000), 1),
        instructor_name: c.instructor_name ?? null,
        description: c.description ?? null,
        age_range: c.age_range ?? null,
        caregiver_participation: c.caregiver_participation ?? null,
        schedule_note: c.schedule_note ?? null,
        schedule_label: c.schedule_label ?? null,
        booked_count: booked,
        seats_left: c.capacity == null ? null : Math.max(c.capacity - booked, 0),
        waitlist_offer_pending: await hasActiveWaitlistOffer(supa, c.id).catch(() => false),
        waitlist_count: await countWaitlistRegistrations(supa, c.id).catch(() => 0),
        is_popular: booked > 0 && booked >= popularThreshold,
        recommended_class_ids: recommendations.map((entry) => entry.class_id),
      };
    }));

    return Response.json({ ok: true, items }, { headers: NO_STORE_HEADERS });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'unknown error';
    return Response.json({ ok: false, error: message }, { status: 500, headers: NO_STORE_HEADERS });
  }
}
