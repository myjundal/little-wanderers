'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { PARTY_PRIVACY_UPDATED_EVENT } from '@/lib/private-party-open-play';
import styles from './party-schedule-editor.module.css';

type Booking = { id: string; start_time: string; end_time: string; is_private: boolean };
type Conflict = { id: string; household_id: string; household_name: string; child_count: number; adult_count: number };

export default function PartyPrivacyEditor({ booking, disabled = false }: { booking: Booking; disabled?: boolean }) {
  const [isPrivate, setPrivate] = useState(booking.is_private);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const saving = useRef(false);

  useEffect(() => { setPrivate(booking.is_private); }, [booking.is_private]);
  useEffect(() => {
    if (!booking.is_private) { setConflicts([]); return; }
    const controller = new AbortController();
    fetch(`/api/admin/party-bookings/${booking.id}/privacy`, { cache: 'no-store', signal: controller.signal })
      .then(response => response.json()).then(result => {
        if (!controller.signal.aborted) {
          if (!result.ok || !result.conflicts_available) throw new Error('Unable to check existing Open Play reservations. Refresh and review before the party.');
          setConflicts(result.conflicts ?? []);
        }
      }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Unable to check existing reservations.'); });
    return () => controller.abort();
  }, [booking.id, booking.start_time, booking.is_private]);

  async function save(next: boolean) {
    if (saving.current || disabled) return;
    saving.current = true; setBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch(`/api/admin/party-bookings/${booking.id}/privacy`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_private: next, expected_is_private: isPrivate, expected_start_time: booking.start_time }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || 'Unable to save the private party setting.');
      setPrivate(result.item.is_private); setConflicts(result.conflicts ?? []);
      setMessage(!result.conflicts_available
        ? 'Private setting saved. Unable to check existing reservations; refresh and review Open Play before the party.'
        : result.item.is_private ? 'Private party saved. New Open Play arrivals from 4–6pm are blocked; earlier guests must finish by 4pm.'
        : 'Private setting removed. Manually closed times remain closed.');
      window.dispatchEvent(new CustomEvent(PARTY_PRIVACY_UPDATED_EVENT, { detail: result.item }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to save the private party setting.');
    } finally { saving.current = false; setBusy(false); }
  }

  return <section className={styles.editor} aria-label="Private party setting">
    <label className={styles.privacyToggle}>
      <input type="checkbox" checked={isPrivate} disabled={busy || disabled} onChange={event => void save(event.target.checked)} />
      Private party · exclusive use 4–6pm
    </label>
    <p>Checking this ends Open Play at 4pm on the party date and blocks new 4–6pm reservations. The block follows date changes and ends if this party is cancelled or unchecked.</p>
    <p>Existing reservations are kept. Manually closed times stay closed when you uncheck this.</p>
    {error && <p className={styles.error} role="alert">{error}</p>}
    <p className={styles.feedback} role="status" aria-live="polite">{busy ? 'Saving private setting…' : message}</p>
    {conflicts.length > 0 && <div role="alert">
      <strong>{conflicts.length} existing Open Play reservation{conflicts.length === 1 ? '' : 's'} overlap 4–6pm. Contact these families to arrange changes; nothing was cancelled.</strong>
      <ul>{conflicts.map(item => <li key={item.id}><Link href={`/staff/families/${item.household_id}`}>{item.household_name}</Link> · {item.child_count} children / {item.adult_count} adults</li>)}</ul>
    </div>}
  </section>;
}
