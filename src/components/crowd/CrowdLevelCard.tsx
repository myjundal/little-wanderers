'use client';

import type { CSSProperties } from 'react';
import { useEffect, useState } from 'react';
import type { PublicCrowdPayload } from '@/lib/public-crowd';
import styles from './CrowdLevelCard.module.css';

type CrowdPayload = PublicCrowdPayload;

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

export default function CrowdLevelCard({ compact = false, style, showHours = true, showStatus = true }: { compact?: boolean; style?: CSSProperties; showHours?: boolean; showStatus?: boolean }) {
  const [data, setData] = useState<CrowdPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (!showHours) return;
    const updateClock = () => setNow(new Date());
    const interval = window.setInterval(updateClock, 60_000);
    document.addEventListener('visibilitychange', updateClock);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', updateClock);
    };
  }, [showHours]);

  useEffect(() => {
    if (!showStatus) return;
    let alive = true;
    let inFlight = false;
    const controller = new AbortController();

    const load = async () => {
      if (inFlight || document.hidden) return;
      inFlight = true;
      try {
        const res = await fetch(`/api/crowd-level?ts=${Date.now()}`, { cache: 'no-store', signal: controller.signal });
        const json = (await res.json()) as CrowdPayload;

        if (!alive) return;
        if (!res.ok || !json.ok || !['welcome', 'busy', 'very_busy', 'closed'].includes(json.status)) {
          setError('Our crowd update is unavailable. Please check availability before heading over.');
          setData(null);
          return;
        }

        setData(json);
        setError(null);
      } catch {
        if (!alive) return;
        setError('Our crowd update is unavailable. Please check availability before heading over.');
        setData(null);
      } finally {
        inFlight = false;
        if (alive) setLoading(false);
      }
    };

    load();
    const interval = window.setInterval(load, 10_000);
    document.addEventListener('visibilitychange', load);

    return () => {
      alive = false;
      controller.abort();
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', load);
    };
  }, [showStatus]);

  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: BUSINESS_TIME_ZONE, weekday: 'long' }).format(now);
  const dayIndex = WEEKLY_HOURS.findIndex((entry) => entry.label === weekday);
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: BUSINESS_TIME_ZONE, hour: 'numeric', hourCycle: 'h23' }).format(now));
  const todaysCloseHour = dayIndex === 5 || dayIndex === 6 ? 19 : 18;
  const isOpenNow = hour >= 9 && hour < todaysCloseHour;
  const todaysHours = WEEKLY_HOURS[dayIndex]?.hours ?? '9am–6pm';
  const currentDate = now.toLocaleDateString('en-US', {
    timeZone: BUSINESS_TIME_ZONE,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  const currentTime = now.toLocaleTimeString('en-US', {
    timeZone: BUSINESS_TIME_ZONE,
    hour: 'numeric',
    minute: '2-digit',
  });

  return (
    <section className={`${styles.card} ${styles[data?.status ?? 'unavailable']}`} aria-label="Open Play crowd level" style={{ ...(compact ? { maxWidth: 470 } : {}), ...(style ?? {}) }}>
      {showHours && <div className={styles.hoursBlock}>
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
      </div>}
      {showStatus && <>
        <div className={styles.titleRow}>
          <span className={styles.eyebrow}>Open Play · Crowd Level</span>
          <details className={styles.about}>
            <summary aria-label="About the crowd update">ⓘ</summary>
            <p>A gentle estimate of how the studio feels, updated throughout the day. Availability can change; please check Open Play times before visiting.</p>
          </details>
        </div>
        <div aria-live="polite">
          <h2 className={styles.status}><span className={styles.dot} aria-hidden="true" />{data?.label ?? (loading ? 'Checking the studio…' : 'Check before visiting')}</h2>
          <div className={styles.description}>{data?.description ?? (loading ? 'Getting the latest crowd update.' : error)}</div>
        </div>
      </>}
    </section>
  );
}
