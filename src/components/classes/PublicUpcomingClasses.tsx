'use client';

import { useEffect, useMemo, useState } from 'react';
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
  capacity: number | null;
  price_cents: number;
  booked_count: number;
  seats_left: number | null;
};

const eyebrowStyle: CSSProperties = {
  margin: 0,
  color: '#7b6aa8',
  fontSize: 13,
  fontWeight: 700,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
};

const sectionStyle: CSSProperties = {
  marginTop: 28,
  padding: 'clamp(20px, 4vw, 26px)',
  borderRadius: 28,
  background: 'rgba(255,255,255,0.62)',
  border: '1px solid rgba(255,255,255,0.74)',
  boxShadow: '0 16px 32px rgba(123, 106, 168, 0.06)',
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

  const visibleClasses = useMemo(() => classes.slice(0, 6), [classes]);

  if (loading || error || visibleClasses.length === 0) return null;

  return (
    <section style={sectionStyle}>
      <p style={eyebrowStyle}>Upcoming schedule</p>
      <h2 style={{ margin: '12px 0 0', color: '#4b4360', fontSize: 'clamp(1.75rem, 3vw, 2.25rem)' }}>
        Classes will appear here as they are added.
      </h2>
      <p style={{ margin: '10px 0 0', color: '#7e7695', lineHeight: 1.75 }}>
        We&apos;ll share dates, age groups, instructors, and registration details once each program is ready.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14, marginTop: 18 }}>
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
              {item.age_range && (
                <span style={{ color: '#8f85a5', fontSize: 13, fontWeight: 700 }}>{item.age_range}</span>
              )}
            </div>

            <h3 style={{ margin: 0, color: '#4b4360', fontSize: '1.25rem' }}>{item.title}</h3>
            <p style={{ margin: 0, color: '#7e7695', lineHeight: 1.6 }}>
              {formatClassTime(item.start_time, item.end_time)}
            </p>
            <p style={{ margin: 0, color: '#7e7695', lineHeight: 1.6 }}>
              {item.instructor_name ? `With ${item.instructor_name}` : 'Instructor to be announced'}
            </p>
            {item.description && <p style={{ margin: 0, color: '#6f628d', lineHeight: 1.7 }}>{item.description}</p>}

            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginTop: 4 }}>
              <strong style={{ color: '#7b6aa8' }}>{formatPrice(item.price_cents)}</strong>
              <span style={{ color: '#8f85a5', fontSize: 13, fontWeight: 700 }}>
                {item.seats_left == null ? 'Capacity varies' : `${item.seats_left} spots left`}
              </span>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
