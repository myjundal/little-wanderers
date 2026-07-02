'use client';

import { useEffect, useState } from 'react';

import styles from '@/app/(public)/home.module.css';
import type { WaitlistDisplayCount } from '@/lib/waitlist-count';

const REFRESH_INTERVAL_MS = 60_000;

export default function WaitlistCountCard({ initialCount, variant = 'default' }: { initialCount: WaitlistDisplayCount; variant?: 'default' | 'compact' }) {
  const [count, setCount] = useState(initialCount);

  useEffect(() => {
    let isActive = true;

    const refreshCount = async () => {
      try {
        const response = await fetch('/api/waitlist-count', { cache: 'no-store' });
        if (!response.ok) return;

        const nextCount = (await response.json()) as WaitlistDisplayCount;
        if (isActive && Number.isInteger(nextCount.displayCount) && nextCount.displayCount >= 0) {
          setCount(nextCount);
        }
      } catch {
        // Keep the last successful count when the network is unavailable.
      }
    };

    void refreshCount();
    const intervalId = window.setInterval(refreshCount, REFRESH_INTERVAL_MS);

    return () => {
      isActive = false;
      window.clearInterval(intervalId);
    };
  }, []);

  return (
    <aside
      className={`${styles.waitlistCountCard} ${variant === 'compact' ? styles.waitlistCountCardCompact : ''}`}
      aria-label={`${count.displayCount} plus local families have joined the waitlist`}
    >
      <div className={styles.waitlistNumberStage} aria-live="polite" aria-atomic="true">
        <strong key={count.displayCount} className={styles.waitlistNumber}>
          {count.displayCount}+
        </strong>
      </div>
      <div className={styles.waitlistCountCopy}>
        <span className={styles.waitlistCountEyebrow}>
          {variant === 'compact' ? 'waitlist families' : 'Families already joined on the waitlist!'}
        </span>
      </div>
    </aside>
  );
}
