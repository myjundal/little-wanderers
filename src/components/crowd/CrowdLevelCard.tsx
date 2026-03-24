'use client';

import type { CSSProperties } from 'react';
import { useEffect, useState } from 'react';
import styles from './CrowdLevelCard.module.css';

type CrowdPayload = {
  ok: boolean;
  occupancy: number;
  capacity: number;
  progress: number;
  crowd_level: 'light' | 'moderate' | 'busy' | 'near_capacity';
  label: string;
  description: string;
  accent: string;
  accent_strong: string;
  last_updated_at: string | null;
  error?: string;
};

const LEVELS = ['light', 'moderate', 'busy', 'near_capacity'] as const;
const LEVEL_LABELS: Record<(typeof LEVELS)[number], string> = {
  light: 'Light',
  moderate: 'Moderate',
  busy: 'Busy',
  near_capacity: 'Near Capacity',
};

const BUSINESS_TIME_ZONE = 'America/New_York';
const WEEKLY_HOURS = [
  { label: 'Sunday', hours: '9am–6pm' },
  { label: 'Monday', hours: '9am–6pm' },
  { label: 'Tuesday', hours: '9am–6pm' },
  { label: 'Wednesday', hours: '9am–6pm' },
  { label: 'Thursday', hours: '9am–6pm' },
  { label: 'Friday', hours: '9am–7pm' },
  { label: 'Saturday', hours: '9am–7pm' },
];

export default function CrowdLevelCard({ eyebrow = 'Current vibe', compact = false, style }: { eyebrow?: string; compact?: boolean; style?: CSSProperties }) {
  const [data, setData] = useState<CrowdPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    const load = async () => {
      try {
        setLoading(true);
        const res = await fetch(`/api/crowd-level?ts=${Date.now()}`, { cache: 'no-store' });
        const json = (await res.json()) as CrowdPayload;

        if (!alive) return;
        if (!res.ok || !json.ok) {
          setError(json.error ?? 'Unable to load the current crowd level right now.');
          setData(null);
          return;
        }

        setData(json);
        setError(null);
      } catch {
        if (!alive) return;
        setError('Unable to load the current crowd level right now.');
        setData(null);
      } finally {
        if (alive) setLoading(false);
      }
    };

    load();
    const interval = window.setInterval(load, 10_000);

    return () => {
      alive = false;
      window.clearInterval(interval);
    };
  }, []);

  const now = new Date();
  const localNow = new Date(now.toLocaleString('en-US', { timeZone: BUSINESS_TIME_ZONE }));
  const dayIndex = localNow.getDay();
  const hour = localNow.getHours();
  const todaysCloseHour = dayIndex === 5 || dayIndex === 6 ? 19 : 18;
  const isOpenNow = hour >= 9 && hour < todaysCloseHour;
  const todaysHours = WEEKLY_HOURS[dayIndex]?.hours ?? '9am–6pm';
  const currentDate = localNow.toLocaleDateString('en-US', {
    timeZone: BUSINESS_TIME_ZONE,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  const currentTime = localNow.toLocaleTimeString('en-US', {
    timeZone: BUSINESS_TIME_ZONE,
    hour: 'numeric',
    minute: '2-digit',
  });

  return (
    <section className={styles.card} aria-live="polite" style={{ ...(compact ? { padding: 16 } : {}), ...(style ?? {}) }}>
      <p className={styles.eyebrow}>{eyebrow}</p>
      <div className={styles.hoursBlock}>
        <p className={styles.currentDateTime}>{currentDate} · {currentTime}</p>
        <p className={styles.openStatus}>
          {isOpenNow ? 'Come on in, we are open now!' : 'We are closed now, but see you soon!'}
        </p>
        <p className={styles.todayHours}>Today&apos;s operating hours: {todaysHours}</p>
        <details className={styles.otherHours}>
          <summary>Other operating hours</summary>
          <ul>
            {WEEKLY_HOURS.map((entry) => (
              <li key={entry.label}>
                <span>{entry.label}</span>
                <strong>{entry.hours}</strong>
              </li>
            ))}
          </ul>
        </details>
      </div>
      <div className={styles.titleRow}>
        <div>
          <h3 style={{ margin: 0, color: '#4f3f82', fontSize: compact ? '1.1rem' : '1.35rem' }}>Current estimated crowd level</h3>
          <p className={styles.helper} style={{ marginTop: 8, marginBottom: 0 }}>
            {loading ? 'Refreshing today’s approximate studio flow…' : data?.description ?? 'A gentle estimate instead of an exact real-time headcount.'}
          </p>
        </div>
        <span
          className={styles.badge}
          style={{ background: `linear-gradient(135deg, ${data?.accent ?? '#eadcff'}, ${data?.accent_strong ?? '#8751df'})` }}
        >
          {data?.label ?? 'Loading'}
        </span>
      </div>

      <div className={styles.progressTrack}>
        <div
          className={styles.progressFill}
          style={{
            width: `${Math.max((data?.progress ?? 0.1) * 100, 10)}%`,
            background: `linear-gradient(90deg, ${data?.accent ?? '#eadcff'}, ${data?.accent_strong ?? '#8751df'})`,
          }}
        />
      </div>

      <div className={styles.metrics}>
        <div className={styles.metricCard}>
          <span className={styles.metricLabel}>Current estimated occupancy</span>
          <strong className={styles.metricValue}>
            {loading ? '—' : `${data?.occupancy ?? 0} / ${data?.capacity ?? 24}`}
          </strong>
        </div>
        <div className={styles.metricCard}>
          <span className={styles.metricLabel}>Flow complexity</span>
          <strong className={styles.metricValue}>{loading ? 'Refreshing…' : data?.label ?? 'Loading'}</strong>
        </div>
      </div>

      <div className={styles.scale}>
        {LEVELS.map((level) => {
          const active = data?.crowd_level === level;
          return (
            <div
              key={level}
              className={`${styles.scaleItem} ${active ? styles.active : ''}`.trim()}
              style={active ? { background: data?.accent_strong ?? '#8751df' } : undefined}
            >
              {LEVEL_LABELS[level]}
            </div>
          );
        })}
      </div>

      <div className={styles.meta}>
        <span>{data?.last_updated_at ? `Updated ${new Date(data.last_updated_at).toLocaleTimeString()}` : 'Updates throughout the day'}</span>
      </div>

      {error && <p className={`${styles.helper} ${styles.error}`}>{error}</p>}
    </section>
  );
}
