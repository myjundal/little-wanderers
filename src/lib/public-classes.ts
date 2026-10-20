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
};

export type PublicClassSeries = PublicClassItem & {
  occurrences: PublicClassItem[];
};

const CLASS_TIME_ZONE = 'America/New_York';
const WEEKDAY_VALUES = new Map([
  ['Sun', 0],
  ['Mon', 1],
  ['Tue', 2],
  ['Wed', 3],
  ['Thu', 4],
  ['Fri', 5],
  ['Sat', 6],
]);

export const WEEKDAY_COLUMNS = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
];

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
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CLASS_TIME_ZONE,
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const weekday = parts.find((part) => part.type === 'weekday')?.value;
  const hour = parts.find((part) => part.type === 'hour')?.value;
  const minute = parts.find((part) => part.type === 'minute')?.value;
  const day = weekday ? WEEKDAY_VALUES.get(weekday) : undefined;
  if (day == null || hour == null || minute == null) return null;
  return `${day}-${Number(hour)}-${Number(minute)}`;
}

function classWeekdayValue(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: CLASS_TIME_ZONE,
    weekday: 'short',
  }).format(date);
  return WEEKDAY_VALUES.get(weekday) ?? null;
}

export function buildGeneralWeeklySchedule(seriesItems: PublicClassSeries[]) {
  const grouped = new Map<number, PublicClassItem[]>();
  WEEKDAY_COLUMNS.forEach((day) => grouped.set(day.value, []));

  seriesItems.forEach((series) => {
    const seen = new Set<string>();
    series.occurrences.forEach((item) => {
      const day = classWeekdayValue(item.start_time);
      if (day == null || !grouped.has(day)) return;
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
  return date.toLocaleTimeString('en-US', { timeZone: CLASS_TIME_ZONE, hour: 'numeric', minute: '2-digit' }).toLowerCase();
}

export function compactCaregiverLabel(value: string | null) {
  if (!value) return 'Participation TBA';
  if (value.toLowerCase().includes('drop')) return 'Drop-off';
  return value;
}
