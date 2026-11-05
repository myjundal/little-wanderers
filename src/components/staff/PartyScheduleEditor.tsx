'use client';

import { useId, useRef, useState } from 'react';
import { getPartyDateKey } from '@/lib/party-config';
import { getPartyTimeValue, parsePartySchedule, PARTY_SCHEDULE_UPDATED_EVENT } from '@/lib/party-management';
import styles from './party-schedule-editor.module.css';

export type PartySchedule = { id: string; start_time: string; end_time: string };

export default function PartyScheduleEditor({ booking, onSaved, disabled = false }: {
  booking: PartySchedule;
  onSaved: (item: PartySchedule) => void;
  disabled?: boolean;
}) {
  const fieldId = useId();
  const [date, setDate] = useState(() => getPartyDateKey(booking.start_time));
  const [start, setStart] = useState(() => getPartyTimeValue(booking.start_time));
  const [end, setEnd] = useState(() => getPartyTimeValue(booking.end_time));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const saving = useRef(false);
  const changed = date !== getPartyDateKey(booking.start_time)
    || start !== getPartyTimeValue(booking.start_time) || end !== getPartyTimeValue(booking.end_time);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving.current || disabled || !changed) return;
    setError(''); setMessage('');
    if (!parsePartySchedule(date, start, end)) {
      setError('Choose a valid date and an end time after the start time.');
      return;
    }
    saving.current = true;
    setBusy(true);
    try {
      const response = await fetch(`/api/admin/party-bookings/${booking.id}/schedule`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, start_time: start, end_time: end,
          expected_start_time: booking.start_time, expected_end_time: booking.end_time }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || 'Unable to save the party schedule.');
      setMessage('Party date and time saved.');
      window.dispatchEvent(new CustomEvent(PARTY_SCHEDULE_UPDATED_EVENT, { detail: result.item }));
      onSaved(result.item);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to save the party schedule.');
    } finally { saving.current = false; setBusy(false); }
  }

  return <form className={styles.editor} aria-label="Edit party date and time" onSubmit={save}>
    <h4>Change date &amp; time</h4>
    <p>All times are Eastern Time.</p>
    <fieldset disabled={busy || disabled}>
      <div className={styles.fields}>
        <label htmlFor={`${fieldId}-date`}>Party date<input id={`${fieldId}-date`} type="date" required value={date} onChange={event => { setDate(event.target.value); setMessage(''); }} /></label>
        <label htmlFor={`${fieldId}-start`}>Start time<input id={`${fieldId}-start`} type="time" required value={start} onChange={event => { setStart(event.target.value); setMessage(''); }} /></label>
        <label htmlFor={`${fieldId}-end`}>End time<input id={`${fieldId}-end`} type="time" required value={end} onChange={event => { setEnd(event.target.value); setMessage(''); }} /></label>
      </div>
      <button type="submit" disabled={!changed}>{busy ? 'Saving…' : 'Save date & time'}</button>
    </fieldset>
    {error && <p className={styles.error} role="alert">{error}</p>}
    <p className={styles.feedback} role="status" aria-live="polite">{message}</p>
  </form>;
}
