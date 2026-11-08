'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { RosterSession } from '@/lib/class-rosters';
import styles from './class-check-in.module.css';

const dateLabel = (date: string) => new Date(date).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
export default function ClassCheckIn({ sessions, onRefresh, allowManualRegistration = false }: { sessions: RosterSession[]; onRefresh: () => void | Promise<void>; allowManualRegistration?: boolean }) {
  const [title, setTitle] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [saving, setSaving] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const ordered = [...sessions].sort((a,b) => Date.parse(a.startTime) - Date.parse(b.startTime));
  const filtered = ordered.filter(session => !title || session.title === title);
  const selected = filtered.find(session => session.id === selectedId) ?? filtered.find(session => Date.parse(session.endTime) >= Date.now() && session.status === 'scheduled') ?? filtered[filtered.length - 1];
  const confirmed = (selected?.registrations ?? []).filter(reg => ['scheduled','attended'].includes(reg.status)).sort((a,b) => a.name.localeCompare(b.name));
  const interested = (selected?.registrations ?? []).filter(reg => reg.status === 'preregistered').sort((a,b) => a.name.localeCompare(b.name));
  const present = (reg: RosterSession['registrations'][number]) => reg.attendanceStatus === 'attended' || (!reg.attendanceStatus && reg.status === 'attended');
  const mark = async (registrationId: string, checkedIn: boolean) => {
    if (!selected || saving) return;
    setSaving(registrationId); setError(''); setMessage('');
    try {
      const res = await fetch(`/api/admin/classes/${selected.id}/attendance`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ registration_id: registrationId, attendance_status: checkedIn ? 'unknown' : 'attended' }) });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Unable to save check-in.');
      await onRefresh(); setMessage(checkedIn ? 'Check-in cleared.' : 'Checked in.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to save check-in.'); }
    finally { setSaving(''); }
  };
  return <section className={styles.panel} aria-labelledby="class-check-in-heading">
    <header className={styles.heading}><div><h2 id="class-check-in-heading">Class check-in</h2><p>Check in confirmed children. Registration changes and cancellations are handled by the owner.</p></div><button onClick={() => void onRefresh()}>Refresh</button></header>
    {allowManualRegistration && <p className={styles.manual}><Link href="/staff/families">Register a walk-in family →</Link><span>New manual registrations are available from the family’s page. Payment is required to confirm a seat.</span></p>}
    <div className={styles.filters}><label>Class<select value={title} onChange={e => { setTitle(e.target.value); setSelectedId(''); setMessage(''); }}><option value="">All classes</option>{[...new Set(ordered.map(item => item.title))].sort().map(value => <option key={value}>{value}</option>)}</select></label><label>Session<select value={selected?.id ?? ''} onChange={e => { setSelectedId(e.target.value); setMessage(''); }}>{filtered.map(session => <option key={session.id} value={session.id}>{dateLabel(session.startTime)} · {session.title}{session.status === 'cancelled' ? ' (Cancelled)' : ''}</option>)}</select></label></div>
    {error && <p role="alert" className={styles.error}>{error}</p>}{message && <p role="status" className={styles.success}>{message}</p>}
    {!selected ? <p>No class sessions available.</p> : <>
      <div className={styles.session}><div><h3>{selected.title}</h3><p>{dateLabel(selected.startTime)} · Eastern</p></div><strong>{confirmed.filter(present).length} / {confirmed.length} checked in</strong></div>
      {selected.status === 'cancelled' && <p className={styles.error}>This session is cancelled. Check-in is unavailable.</p>}
      {selected.instructorNote && <details className={styles.notes}><summary>Owner’s class notes</summary><p>{selected.instructorNote}</p></details>}
      {!confirmed.length ? <p className={styles.empty}>No confirmed children for this session.</p> : <ul className={styles.children}>{confirmed.map(reg => <li key={reg.id}><div><strong>{reg.name}</strong><span>{reg.age != null ? `Age ${reg.age} · ` : ''}{present(reg) ? 'Checked in' : 'Not checked in'}</span></div><button disabled={Boolean(saving) || selected.status !== 'scheduled' || reg.attendanceStatus === 'cancelled'} onClick={() => void mark(reg.id, present(reg))} className={present(reg) ? styles.undo : styles.checkIn}>{saving === reg.id ? 'Saving…' : present(reg) ? 'Undo check-in' : 'Check in'}</button></li>)}</ul>}
      {interested.length > 0 && <details className={styles.notes}><summary>Interest only — no confirmed seat ({interested.length})</summary><p>Payment is required before check-in. Ask the owner to resolve registration questions.</p><ul>{interested.map(reg => <li key={reg.id}>{reg.name}</li>)}</ul></details>}
    </>}
  </section>;
}
