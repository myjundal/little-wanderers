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

export default function CrowdLevelCard({ eyebrow = 'Current vibe', compact = false, style }: { eyebrow?: string; compact?: boolean; style?: CSSProperties }) {
  const [data, setData] = useState<CrowdPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    const load = async () => {
      try {
        setLoading(true);
        const res = await fetch('/api/crowd-level', { cache: 'no-store' });
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
    const interval = window.setInterval(load, 60_000);

    return () => {
      alive = false;
      window.clearInterval(interval);
    };
  }, []);

  return (
    <section className={styles.card} aria-live="polite" style={{ ...(compact ? { padding: 16 } : {}), ...(style ?? {}) }}>
      <p className={styles.eyebrow}>{eyebrow}</p>
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
        <span>{loading ? 'Loading…' : `Approximate occupancy reference: ${data?.capacity ?? 24} guests`}</span>
        <span>{data?.last_updated_at ? `Updated ${new Date(data.last_updated_at).toLocaleTimeString()}` : 'Updates throughout the day'}</span>
      </div>

      {error && <p className={`${styles.helper} ${styles.error}`}>{error}</p>}
    </section>
  );
}
