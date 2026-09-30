import { createAdminSupabaseClient } from '@/lib/supabase/admin';

export type PublicClassItem = {
  id: string;
  title: string;
  category: string | null;
  start_time: string;
  end_time: string;
  duration_minutes: number | null;
  instructor_name: string | null;
  description: string | null;
  age_range: string | null;
  caregiver_participation: string | null;
  schedule_note: string | null;
  schedule_label: string | null;
  capacity: number | null;
  price_cents: number;
  booked_count: number;
  seats_left: number | null;
  waitlist_offer_pending?: boolean;
  waitlist_count?: number;
};

export type PublicClassSeries = PublicClassItem & {
  occurrences: PublicClassItem[];
};

const CLASS_SELECT = 'id,title,category,start_time,end_time,duration_minutes,instructor_name,description,age_range,caregiver_participation,schedule_note,schedule_label,capacity,price_cents,status';
const CLASS_SELECT_BASE = 'id,title,category,start_time,end_time,capacity,price_cents,status';

type ClassRow = Omit<PublicClassItem, 'booked_count' | 'seats_left' | 'waitlist_offer_pending' | 'waitlist_count'> & {
  status: string;
};

export const WEEKDAY_COLUMNS = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
];

function isMissingClassDetailColumn(message: string) {
  return /column .* does not exist|Could not find the '.*' column/i.test(message);
}

export function publicClassSeriesKey(item: Pick<PublicClassItem, 'title' | 'category' | 'schedule_label' | 'duration_minutes' | 'capacity' | 'price_cents'>) {
  return [
    item.title,
    item.category ?? '',
    item.schedule_label ?? '',
    item.duration_minutes ?? '',
    item.capacity ?? '',
    item.price_cents,
  ].join('::');
}

function firstText(occurrences: PublicClassItem[], key: keyof Pick<PublicClassItem, 'category' | 'instructor_name' | 'description' | 'age_range' | 'caregiver_participation' | 'schedule_note' | 'schedule_label'>) {
  return occurrences.find((item) => item[key])?.[key] ?? null;
}

function seriesBase(occurrences: PublicClassItem[]) {
  const sorted = [...occurrences].sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
  const base = sorted[0];
  return {
    ...base,
    category: firstText(sorted, 'category'),
    instructor_name: firstText(sorted, 'instructor_name'),
    description: firstText(sorted, 'description'),
    age_range: firstText(sorted, 'age_range'),
    caregiver_participation: firstText(sorted, 'caregiver_participation'),
    schedule_note: firstText(sorted, 'schedule_note'),
    schedule_label: firstText(sorted, 'schedule_label'),
    duration_minutes: sorted.find((item) => item.duration_minutes)?.duration_minutes ?? base.duration_minutes,
  };
}

export function groupPublicClassSeries(items: PublicClassItem[]) {
  const groups = new Map<string, PublicClassItem[]>();
  items.forEach((item) => {
    const key = publicClassSeriesKey(item);
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  });

  return Array.from(groups.values()).map((occurrences) => {
    const sorted = [...occurrences].sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
    return { ...seriesBase(sorted), occurrences: sorted } satisfies PublicClassSeries;
  });
}

export function weekdayTimeKey(item: Pick<PublicClassItem, 'start_time'>) {
  const date = new Date(item.start_time);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getDay()}-${date.getHours()}-${date.getMinutes()}`;
}

export function buildGeneralWeeklySchedule(seriesItems: PublicClassSeries[]) {
  const grouped = new Map<number, PublicClassItem[]>();
  WEEKDAY_COLUMNS.forEach((day) => grouped.set(day.value, []));

  seriesItems.forEach((series) => {
    const seen = new Set<string>();
    series.occurrences.forEach((item) => {
      const day = new Date(item.start_time).getDay();
      if (!grouped.has(day)) return;
      const key = weekdayTimeKey(item);
      if (!key || seen.has(key)) return;
      seen.add(key);
      grouped.get(day)!.push(item);
    });
  });

  grouped.forEach((items, day) => {
    grouped.set(day, [...items].sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime()));
  });

  return grouped;
}

export function timeOnlyLabel(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Time TBA';
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase();
}

export function compactSeatsLine(item: Pick<PublicClassItem, 'capacity' | 'seats_left' | 'booked_count' | 'waitlist_offer_pending' | 'waitlist_count'>) {
  if (item.capacity == null) return 'Open';
  if (item.waitlist_offer_pending || (item.waitlist_count ?? 0) > 0) return 'Waitlist open';
  const seatsLeft = item.seats_left ?? Math.max(item.capacity - item.booked_count, 0);
  if (seatsLeft <= 0) return 'Waitlist';
  return `${seatsLeft}/${item.capacity} seats left`;
}

export function compactCaregiverLabel(value: string | null) {
  if (!value) return 'Participation TBA';
  if (value.toLowerCase().includes('drop')) return 'Drop-off';
  return value;
}

async function selectClasses(limit: number) {
  const admin = createAdminSupabaseClient();
  const primary = await admin
    .from('classes')
    .select(CLASS_SELECT)
    .gte('start_time', new Date().toISOString())
    .eq('status', 'scheduled')
    .order('start_time', { ascending: true })
    .limit(limit);

  if (!primary.error) return (primary.data ?? []) as ClassRow[];
  if (!isMissingClassDetailColumn(primary.error.message)) throw primary.error;

  const fallback = await admin
    .from('classes')
    .select(CLASS_SELECT_BASE)
    .gte('start_time', new Date().toISOString())
    .eq('status', 'scheduled')
    .order('start_time', { ascending: true })
    .limit(limit);

  if (fallback.error) throw fallback.error;
  return (fallback.data ?? []) as ClassRow[];
}

export async function getPublicClasses(limit = 80): Promise<PublicClassItem[]> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return [];

  try {
    const admin = createAdminSupabaseClient();
    const classes = await selectClasses(limit);
    const ids = classes.map((item) => item.id);
    const countsByClass = new Map<string, number>();
    const waitlistCountsByClass = new Map<string, number>();
    const waitlistOfferPendingByClass = new Map<string, boolean>();

    if (ids.length > 0) {
      const { data: regs } = await admin
        .from('class_registrations')
        .select('class_id,status,waitlist_offer_expires_at')
        .in('class_id', ids);
      const nowIso = new Date().toISOString();

      (regs ?? []).forEach((row) => {
        if (row.status === 'scheduled' || row.status === 'attended') {
          countsByClass.set(row.class_id, (countsByClass.get(row.class_id) ?? 0) + 1);
        }
        if (row.status === 'waitlist') {
          waitlistCountsByClass.set(row.class_id, (waitlistCountsByClass.get(row.class_id) ?? 0) + 1);
          if (typeof row.waitlist_offer_expires_at === 'string' && row.waitlist_offer_expires_at > nowIso) {
            waitlistOfferPendingByClass.set(row.class_id, true);
          }
        }
      });
    }

    return classes.map((item) => {
      const booked = countsByClass.get(item.id) ?? 0;
      return {
        ...item,
        duration_minutes: item.duration_minutes ?? Math.max(Math.round((new Date(item.end_time).getTime() - new Date(item.start_time).getTime()) / 60_000), 1),
        instructor_name: item.instructor_name ?? null,
        description: item.description ?? null,
        age_range: item.age_range ?? null,
        caregiver_participation: item.caregiver_participation ?? null,
        schedule_note: item.schedule_note ?? null,
        schedule_label: item.schedule_label ?? null,
        booked_count: booked,
        seats_left: item.capacity == null ? null : Math.max(item.capacity - booked, 0),
        waitlist_offer_pending: waitlistOfferPendingByClass.get(item.id) ?? false,
        waitlist_count: waitlistCountsByClass.get(item.id) ?? 0,
      };
    });
  } catch {
    return [];
  }
}
