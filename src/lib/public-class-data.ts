import 'server-only';
import { unstable_cache } from 'next/cache';
import { earliestClassTime } from '@/lib/class-config';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import type { PublicClassItem } from '@/lib/public-classes';

const CLASS_SELECT = 'id,title,category,start_time,end_time,duration_minutes,instructor_name,description,age_range,caregiver_participation,schedule_note,schedule_label,capacity,price_cents,status';
const CLASS_SELECT_BASE = 'id,title,category,start_time,end_time,capacity,price_cents,status';

type ClassRow = PublicClassItem & { status: string };

function isMissingClassDetailColumn(message: string) {
  return /column .* does not exist|Could not find the '.*' column/i.test(message);
}

async function selectClasses(limit: number) {
  const admin = createAdminSupabaseClient();
  const primary = await admin
    .from('classes')
    .select(CLASS_SELECT)
    .gte('start_time', earliestClassTime())
    .eq('status', 'scheduled')
    .order('start_time', { ascending: true })
    .limit(limit);

  if (!primary.error) return (primary.data ?? []) as ClassRow[];
  if (!isMissingClassDetailColumn(primary.error.message)) throw primary.error;

  const fallback = await admin
    .from('classes')
    .select(CLASS_SELECT_BASE)
    .gte('start_time', earliestClassTime())
    .eq('status', 'scheduled')
    .order('start_time', { ascending: true })
    .limit(limit);

  if (fallback.error) throw fallback.error;
  return (fallback.data ?? []) as ClassRow[];
}

const readPublicClasses = unstable_cache(async (limit: number): Promise<PublicClassItem[]> => {
  const classes = await selectClasses(limit);
  return classes.map((item) => ({
    ...item,
    duration_minutes: item.duration_minutes ?? Math.max(Math.round((new Date(item.end_time).getTime() - new Date(item.start_time).getTime()) / 60_000), 1),
    instructor_name: item.instructor_name ?? null,
    description: item.description ?? null,
    age_range: item.age_range ?? null,
    caregiver_participation: item.caregiver_participation ?? null,
    schedule_note: item.schedule_note ?? null,
    schedule_label: item.schedule_label ?? null,
  }));
}, ['public-class-catalog-v1'], { revalidate: 60 });

export async function getPublicClasses(limit = 80): Promise<PublicClassItem[]> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return [];
  try {
    return await readPublicClasses(limit);
  } catch {
    return [];
  }
}
