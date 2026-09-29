'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { CSSProperties } from 'react';

type ClassItem = {
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

type ClassSeries = ClassItem & {
  occurrences: ClassItem[];
};

const sectionStyle: CSSProperties = {
  display: 'grid',
  gap: 14,
};

const classCardStyle: CSSProperties = {
  display: 'grid',
  gap: 10,
  padding: 18,
  borderRadius: 22,
  background: 'rgba(255,253,249,0.96)',
  border: '1px solid rgba(232,223,239,0.96)',
  boxShadow: '0 12px 26px rgba(123, 106, 168, 0.07)',
};

function formatClassTime(startTime: string, endTime: string) {
  const start = new Date(startTime);
  const end = new Date(endTime);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 'Time to be announced';

  const date = start.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
  const startLabel = start.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
  const endLabel = end.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });

  return `${date} · ${startLabel} - ${endLabel}`;
}

function formatPrice(cents: number) {
  if (!Number.isFinite(cents) || cents <= 0) return 'Price to be announced';
  return `$${(cents / 100).toFixed(2)}`;
}

function formatCapacity(capacity: number | null) {
  return capacity == null ? 'Class size varies' : `Max ${capacity} kids`;
}

function seriesKey(item: ClassItem) {
  return [
    item.title,
    item.category ?? '',
    item.schedule_label ?? '',
    item.duration_minutes ?? '',
    item.capacity ?? '',
    item.price_cents,
  ].join('::');
}

function firstText(occurrences: ClassItem[], key: keyof Pick<ClassItem, 'category' | 'instructor_name' | 'description' | 'age_range' | 'caregiver_participation' | 'schedule_note' | 'schedule_label'>) {
  return occurrences.find((item) => item[key])?.[key] ?? null;
}

function seriesBase(occurrences: ClassItem[]) {
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

function groupClassSeries(items: ClassItem[]) {
  const groups = new Map<string, ClassItem[]>();
  items.forEach((item) => {
    const key = seriesKey(item);
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  });

  return Array.from(groups.values()).map((occurrences) => {
    const sorted = [...occurrences].sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
    return { ...seriesBase(sorted), occurrences: sorted } satisfies ClassSeries;
  });
}

function formatOccurrenceDate(item: ClassItem) {
  const start = new Date(item.start_time);
  if (Number.isNaN(start.getTime())) return 'Date TBA';
  return start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function seatLabel(item: ClassItem) {
  if (item.waitlist_offer_pending) return 'offer pending';
  if ((item.waitlist_count ?? 0) > 0) return 'waitlist';
  if (item.seats_left == null) return 'open';
  return item.seats_left > 0 ? `${item.seats_left} left` : 'waitlist';
}

function shouldShowPublicDates(item: ClassSeries) {
  return !item.schedule_note;
}

function ScheduleLine({ item }: { item: Pick<ClassItem, 'schedule_note' | 'schedule_label' | 'start_time' | 'end_time'> }) {
  if (item.schedule_note && item.schedule_label) {
    return (
      <p style={{ margin: 0, color: '#7e7695', lineHeight: 1.6 }}>
        {item.schedule_note} · <strong style={{ color: '#4b4360' }}>{item.schedule_label}</strong>
      </p>
    );
  }

  if (item.schedule_label) {
    return (
      <p style={{ margin: 0, color: '#7e7695', lineHeight: 1.6 }}>
        <strong style={{ color: '#4b4360' }}>{item.schedule_label}</strong>
      </p>
    );
  }

  return <p style={{ margin: 0, color: '#7e7695', lineHeight: 1.6 }}>{item.schedule_note ?? formatClassTime(item.start_time, item.end_time)}</p>;
}

export default function PublicUpcomingClasses() {
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isActive = true;

    const loadClasses = async () => {
      try {
        const response = await fetch('/api/classes?limit=60', { cache: 'no-store' });
        const payload = (await response.json()) as { ok?: boolean; items?: ClassItem[]; error?: string };
        if (!response.ok || !payload.ok) {
          throw new Error(payload.error ?? 'Unable to load classes.');
        }
        if (isActive) {
          setClasses(payload.items ?? []);
          setError(null);
        }
      } catch {
        if (isActive) {
          setError('Class schedule details are still being finalized.');
        }
      } finally {
        if (isActive) setLoading(false);
      }
    };

    void loadClasses();

    return () => {
      isActive = false;
    };
  }, []);

  const visibleClasses = useMemo(() => groupClassSeries(classes).slice(0, 6), [classes]);

  if (loading || error || visibleClasses.length === 0) return null;

  return (
    <section style={sectionStyle}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 360px), 1fr))', gap: 14 }}>
        {visibleClasses.map((item) => (
          <article key={item.id} style={classCardStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {item.category && (
                <span
                  style={{
                    padding: '5px 9px',
                    borderRadius: 999,
                    background: '#f3ecfb',
                    color: '#7b6aa8',
                    border: '1px solid #dfd1ef',
                    fontSize: 12,
                    fontWeight: 800,
                  }}
                >
                  {item.category}
                </span>
              )}
            </div>

            <h3 style={{ margin: 0, color: '#4b4360', fontSize: '1.25rem' }}>{item.title}</h3>
            <ScheduleLine item={item} />
            {shouldShowPublicDates(item) && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {item.occurrences.slice(0, 6).map((occurrence) => (
                  <span
                    key={occurrence.id}
                    style={{
                      borderRadius: 999,
                      border: '1px solid #eadff3',
                      background: '#fff',
                      color: '#6f628d',
                      padding: '6px 9px',
                      fontSize: 12,
                      fontWeight: 800,
                    }}
                  >
                    {formatOccurrenceDate(occurrence)} · {seatLabel(occurrence)}
                  </span>
                ))}
                {item.occurrences.length > 6 && (
                  <span style={{ color: '#8f85a5', fontSize: 12, fontWeight: 800, alignSelf: 'center' }}>
                    +{item.occurrences.length - 6} more
                  </span>
                )}
              </div>
            )}
            {item.instructor_name && (
              <p style={{ margin: 0, color: '#4b4360', lineHeight: 1.6, fontWeight: 800 }}>
                {item.instructor_name}
              </p>
            )}
            {item.description && <p style={{ margin: 0, color: '#6f628d', lineHeight: 1.7 }}>{item.description}</p>}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8, marginTop: 2 }}>
              {item.age_range && (
                <span style={{ borderRadius: 14, border: '1px solid #efe3ff', background: '#fcf9ff', padding: '9px 10px', color: '#6f628d', fontWeight: 700 }}>
                  {item.age_range}
                </span>
              )}
              {item.caregiver_participation && (
                <span style={{ borderRadius: 14, border: '1px solid #efe3ff', background: '#fcf9ff', padding: '9px 10px', color: '#6f628d', fontWeight: 700 }}>
                  {item.caregiver_participation}
                </span>
              )}
              <span style={{ borderRadius: 14, border: '1px solid #efe3ff', background: '#fcf9ff', padding: '9px 10px', color: '#6f628d', fontWeight: 700 }}>
                {item.duration_minutes ? `${item.duration_minutes} min` : 'Length TBA'}
              </span>
              <span style={{ borderRadius: 14, border: '1px solid #efe3ff', background: '#fcf9ff', padding: '9px 10px', color: '#6f628d', fontWeight: 700 }}>
                {formatCapacity(item.capacity)}
              </span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginTop: 4 }}>
              <strong style={{ color: '#7b6aa8' }}>{formatPrice(item.price_cents)}</strong>
              <span style={{ color: '#8f85a5', fontSize: 13, fontWeight: 700 }}>
                {shouldShowPublicDates(item)
                  ? item.occurrences.length === 1 ? seatLabel(item) : `${item.occurrences.length} upcoming dates`
                  : 'Pre-registration open'}
              </span>
            </div>
            <Link
              href="/landing/classschedule"
              style={{
                display: 'inline-flex',
                justifyContent: 'center',
                marginTop: 4,
                borderRadius: 14,
                background: '#5f3da4',
                color: '#fff',
                padding: '11px 14px',
                textDecoration: 'none',
                fontWeight: 800,
              }}
            >
              Pre-register
            </Link>
          </article>
        ))}
      </div>
    </section>
  );
}
