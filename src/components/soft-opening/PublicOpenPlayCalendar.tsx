'use client';
import Link from 'next/link';
import { useState } from 'react';
import type { PublicOpenPlaySlot } from '@/lib/public-open-play';
import styles from './public-open-play.module.css';
const dayKey = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const dateLabel = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric' });
const timeLabel = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: new Date(iso).getUTCMinutes() === 0 ? undefined : '2-digit' });
export default function PublicOpenPlayCalendar({ slots, unavailable = false }: { slots: PublicOpenPlaySlot[]; unavailable?: boolean }) {
  const first = slots.find(slot => !slot.is_closed && !slot.is_full) ?? slots[0];
  const [date, setDate] = useState(first ? dayKey(first.starts_at) : '');
  const [month, setMonth] = useState(first ? dayKey(first.starts_at).slice(0, 7) : '2026-11');
  const [selectedId, setSelectedId] = useState('');
  const start = new Date(`${month}-01T12:00:00Z`);
  const days = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate();
  const label = start.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' });
  const currentSlots = slots.filter(slot => dayKey(slot.starts_at) === date);
  const privateClosing = currentSlots.find(slot => slot.closing_at)?.closing_at;
  const selected = currentSlots.find(slot => slot.id === selectedId);
  function moveMonth(amount: number) {
    const next = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + amount, 1, 12));
    setMonth(next.toISOString().slice(0, 7));
  }
  if (unavailable) return <section className={styles.card} role="status"><h2>Arrival calendar</h2><p>We couldn’t load current availability. Please refresh to try again.</p><button onClick={() => window.location.reload()}>Refresh availability</button></section>;
  if (!slots.length) return <section className={styles.card}><h2>Arrival calendar</h2><p>No arrival windows are currently listed. Please check back soon.</p></section>;
  return <section className={styles.calendarLayout} aria-label="Open Play availability">
    <div className={styles.card}><div className={styles.monthHeader}><button type="button" aria-label="Previous month" disabled={month <= dayKey(slots[0].starts_at).slice(0, 7)} onClick={() => moveMonth(-1)}>←</button><h2>{label}</h2><button type="button" aria-label="Next month" disabled={month >= dayKey(slots[slots.length - 1].starts_at).slice(0, 7)} onClick={() => moveMonth(1)}>→</button></div>
      <div className={styles.weekdays} aria-hidden="true">{['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(day => <span key={day}>{day}</span>)}</div>
      <div className={styles.days}>{Array.from({ length: start.getUTCDay() }, (_, i) => <span key={`blank-${i}`} />)}{Array.from({ length: days }, (_, i) => {
        const key = `${month}-${String(i + 1).padStart(2, '0')}`;
        const windows = slots.filter(slot => dayKey(slot.starts_at) === key && !slot.is_closed && !slot.is_full);
        return <button type="button" key={key} disabled={!windows.length} className={date === key ? styles.selected : ''} aria-pressed={date === key} aria-label={`${dateLabel(key)}, ${windows.length ? 'arrival windows available' : 'no availability'}`} onClick={() => { setDate(key); setSelectedId(''); }}>{i + 1}<span aria-hidden="true">{windows.length ? '•' : ''}</span></button>;
      })}</div><p className={styles.small}>Choose an available date. All times are Eastern.</p>
    </div>
    <div className={styles.card} aria-live="polite"><span className={styles.eyebrow}>Choose your arrival time</span><h2>{dateLabel(date)}</h2>{privateClosing && <p role="status">Open Play ends at {timeLabel(privateClosing)} on this date for a private party. Please finish your visit by then.</p>}<div className={styles.times}>{currentSlots.map(slot => <button type="button" key={slot.id} disabled={slot.is_closed || slot.is_full} aria-pressed={selectedId === slot.id} className={selectedId === slot.id ? styles.selected : ''} onClick={() => setSelectedId(slot.id)}><strong>{timeLabel(slot.starts_at)}–{timeLabel(slot.ends_at)}</strong><small>{slot.is_private_party_blocked ? 'Private party' : slot.is_closed ? 'Closed' : `(${slot.remaining_children}/${slot.capacity_children}) spots left${slot.is_full ? ' · Full' : ''}`}</small></button>)}</div>
      <p className={styles.small}>This is your arrival window. Once you arrive, enjoy unlimited play until closing. Reservations are recommended because capacity is limited; walk-ins are welcome when space allows.</p>
      {selected ? <><Link className={styles.primary} href={`/login?next=${encodeURIComponent(`/landing/open-play?slot=${selected.id}`)}`}>Continue to reserve →</Link><p className={styles.small}>Sign in or create a free account to save this arrival window. No membership needed. Your spot is confirmed after you finish reserving.</p></> : <p className={styles.small}>Browse freely, then choose an arrival time. You’ll sign in or create a free account when you’re ready to reserve.</p>}
    </div>
  </section>;
}
