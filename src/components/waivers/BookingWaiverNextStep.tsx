'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { WaiverStatusDetails } from '@/lib/waivers';
import styles from './booking-waiver-next-step.module.css';

export default function BookingWaiverNextStep({ returnTo, reservationId, promptKey }: {
  returnTo: '/landing/open-play' | '/landing/soft-opening' | '/landing/classschedule';
  reservationId?: string;
  promptKey?: string;
}) {
  const [waiver, setWaiver] = useState<WaiverStatusDetails | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLAnchorElement>(null);
  const prompted = useRef('');
  const params = new URLSearchParams({ return_to: returnTo });
  if (reservationId) params.set('reservation', reservationId);
  const href = `/landing/waiver?${params}`;

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const response = await fetch('/api/waivers', { cache: 'no-store' });
        const result = await response.json();
        if (!response.ok || !['completed', 'required', 'expired'].includes(result.waiver?.status)) throw new Error();
        if (active) { setWaiver(result.waiver); setError(false); }
      } catch { if (active) { setWaiver(null); setError(true); } }
    };
    void refresh();
    window.addEventListener('focus', refresh);
    return () => { active = false; window.removeEventListener('focus', refresh); };
  }, [promptKey, retry]);

  useEffect(() => {
    if (waiver?.status === 'completed') { dialog.current?.close(); return; }
    if (!promptKey || !waiver || prompted.current === promptKey) return;
    prompted.current = promptKey;
    dialog.current?.showModal();
  }, [promptKey, waiver]);

  const complete = waiver?.status === 'completed';
  const title = complete ? 'Family waiver completed' : waiver?.status === 'expired' ? 'One last step: renew your family waiver' : 'One last step: sign your family waiver';
  const explanation = 'Your reservation is saved. Complete one waiver for all your children before arrival. We’ll use the family details from your booking.';
  const close = () => { dialog.current?.close(); trigger.current?.focus(); };

  return <>
    <section className={`${styles.card} ${complete ? styles.complete : ''}`} aria-label="Reservation waiver status" aria-live="polite">
      <p className={styles.eyebrow}>Before your visit</p>
      <h2>{!waiver && !error ? 'Checking your family waiver…' : error ? 'Your reservation is saved' : title}</h2>
      {complete ? <p>Your current waiver covers your family. You’re ready for check-in.</p> : <>
        <p>{error ? 'We couldn’t check your waiver. Open your family waiver to check or finish signing before arrival.' : explanation}</p>
        {(waiver || error) && <Link ref={trigger} className={styles.primary} href={href}>{error ? 'Check / complete family waiver' : 'Continue to family waiver'} →</Link>}
        {error && <button type="button" className={styles.later} onClick={() => setRetry(value => value + 1)}>Try again</button>}
      </>}
    </section>
    {!complete && <dialog ref={dialog} className={styles.dialog} aria-labelledby="booking-waiver-title" aria-describedby="booking-waiver-description" onCancel={() => trigger.current?.focus()}>
      <p className={styles.eyebrow}>Reservation saved</p>
      <h2 id="booking-waiver-title">{title}</h2>
      <p id="booking-waiver-description">{explanation}</p>
      <Link className={styles.primary} href={href}>Continue to family waiver →</Link>
      <button type="button" className={styles.later} onClick={close} autoFocus>I’ll do this before my visit</button>
      <p className={styles.note}>You can return to this step from your reservation.</p>
    </dialog>}
  </>;
}
