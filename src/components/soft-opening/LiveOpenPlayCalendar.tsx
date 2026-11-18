'use client';

import { useCallback, useEffect, useState } from 'react';
import { startVisiblePolling } from '@/lib/visible-polling';
import type { PublicOpenPlaySlot } from '@/lib/public-open-play';
import PublicOpenPlayCalendar from './PublicOpenPlayCalendar';
import styles from './public-open-play.module.css';

export default function LiveOpenPlayCalendar() {
  const [slots, setSlots] = useState<PublicOpenPlaySlot[] | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const retry = useCallback(() => setRefreshKey(value => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    const stopPolling = startVisiblePolling(async () => {
      try {
        const response = await fetch('/api/open-play-availability', { cache: 'no-store', signal: controller.signal });
        const result = await response.json();
        if (!response.ok || !result.ok || !Array.isArray(result.slots)) throw new Error('Availability unavailable');
        if (!controller.signal.aborted) { setSlots(result.slots); setUnavailable(false); }
      } catch {
        if (!controller.signal.aborted) setUnavailable(true);
      }
    }, 60000);
    return () => { controller.abort(); stopPolling(); };
  }, [refreshKey]);

  if (slots === null) return <section className={styles.card} role="status"><h2>Arrival calendar</h2>
    {unavailable ? <><p>We couldn’t load current availability. Please refresh to try again.</p><button onClick={retry}>Refresh availability</button></>
      : <p>Checking current availability…</p>}
  </section>;
  return <PublicOpenPlayCalendar slots={slots} unavailable={unavailable} onRetry={retry} />;
}
