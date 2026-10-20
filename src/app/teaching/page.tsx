'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import AvailabilityCalendar from '@/components/calendar/AvailabilityCalendar';
import { PARTY_TIME_ZONE } from '@/lib/party-config';
import { useOperatorAccess } from '@/lib/use-owner-dashboard-access';
import styles from './teaching.module.css';
import ClassPreRegistrationRosters, { ClassViewSwitcher } from '@/components/classes/ClassPreRegistrationRosters';
import type { RosterSession } from '@/lib/class-rosters';

type Registrant = { id: string; person_id: string; name: string; age: number | null; status: string; attendance_status: string };
type TeachingClass = { id: string; title: string; category: string | null; start_time: string; end_time: string; status: string; capacity: number | null; age_range: string | null; caregiver_participation: string | null; schedule_label: string | null; instructor_note: string | null; registrants: Registrant[] };
const attendanceLabels: Record<string, string> = { unknown: 'Not marked', attended: 'Present', no_show: 'Absent', cancelled: 'Cancelled' };
const dateLabel = (date: string) => new Date(date).toLocaleString('en-US', { timeZone: PARTY_TIME_ZONE, dateStyle: 'medium', timeStyle: 'short' });
const activeRegistration = (reg: Registrant) => reg.status === 'scheduled' || reg.status === 'attended';

export default function TeachingPage() {
  const { canUseOwnerDashboard, isStaff, isKiosk } = useOperatorAccess();
  const [items, setItems] = useState<TeachingClass[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState<string | null>(null);
  const [classView, setClassView] = useState<'rosters' | 'sessions'>('rosters');
  const rosterSessions = useMemo<RosterSession[]>(() => items.map(item => ({
    id: item.id, title: item.title, startTime: item.start_time, endTime: item.end_time,
    status: item.status, scheduleLabel: item.schedule_label,
    registrations: item.registrants.map(reg => ({ id: reg.id, personId: reg.person_id, name: reg.name, age: reg.age, status: reg.status })),
  })), [items]);
  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/teaching', { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? 'Unable to load classes.');
      setItems(json.items);
      setError('');
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to load classes.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const visible = items.filter(item => !title || item.title === title);
  const selected = visible.find(item => item.id === selectedId);
  const select = (id: string) => {
    if (title && items.find(item => item.id === id)?.title !== title) setTitle('');
    setClassView('sessions');
    setSelectedId(id);
    window.setTimeout(() => document.getElementById('class-roster')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  };
  async function mark(reg: Registrant, status: string) {
    if (!selected || saving) return;
    setSaving(reg.id);
    setError('');
    try {
      const res = await fetch(`/api/admin/classes/${selected.id}/attendance`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ registration_id: reg.id, attendance_status: status }) });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? 'Unable to save attendance.');
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to save attendance.'); }
    finally { setSaving(null); }
  }
  return <main className={styles.main}>
    <div className={styles.heading}><div><p>Little Wanderers</p><h1>Teaching Classes</h1><p>Your assigned class rosters across dates, with session attendance when needed.</p></div>
      <nav className={styles.links}><Link href="/">Main Homepage</Link>{!isKiosk && <><Link href="/landing/classschedule">My Classes</Link><Link href="/landing/party">My Parties</Link></>}{canUseOwnerDashboard && <Link href="/staff">{isStaff ? 'Staff Tool' : 'Owner Tool'}</Link>}</nav>
    </div>
    {error && <p role="alert" className={styles.error}>{error} <button onClick={() => void load()}>Retry</button></p>}
    {loading ? <p>Loading your classes…</p> : !items.length ? <section className={styles.card}><h2>No classes assigned yet</h2><p>Your classes will appear here when the owner assigns your account.</p></section> : <>
      <ClassViewSwitcher value={classView} onChange={setClassView} />
      {classView === 'rosters' ? <ClassPreRegistrationRosters sessions={rosterSessions} onSessionSelect={select} onRefresh={load} /> : <>
      <label className={styles.filter}>Class <select value={title} onChange={e => { setTitle(e.target.value); setSelectedId(''); }}><option value="">All my classes</option>{[...new Set(items.map(item => item.title))].map(value => <option key={value}>{value}</option>)}</select></label>
      <AvailabilityCalendar title="Teaching calendar" subtitle="Select a date and class to see its roster. Times are shown in the studio’s time zone." timeZone={PARTY_TIME_ZONE} slots={visible.map(item => ({ id: item.id, start: item.start_time, end: item.end_time, label: `${item.title}${item.status === 'cancelled' ? ' (Cancelled)' : ''}`, status: item.status === 'cancelled' ? 'closed' as const : 'available' as const }))} selectableStatuses={['available', 'closed']} onSlotSelect={slot => select(slot.id)} showUpcoming={false} />
      <section className={styles.card}><h2>Class sessions</h2><div className={styles.sessions}>{visible.map(item => <button key={item.id} className={styles.session} aria-pressed={selectedId === item.id} onClick={() => select(item.id)}><strong>{item.title}</strong><span>{dateLabel(item.start_time)}</span><span>{item.status === 'cancelled' ? 'Cancelled' : `${item.registrants.filter(activeRegistration).length} / ${item.capacity ?? 'No limit'} registered`}</span></button>)}</div></section>
      {selected && <section id="class-roster" className={styles.card}>
        <h2>{selected.title}</h2><p>{dateLabel(selected.start_time)} – {new Date(selected.end_time).toLocaleTimeString('en-US', { timeZone: PARTY_TIME_ZONE, hour: 'numeric', minute: '2-digit' })} · {selected.status}</p>
        <p>{selected.registrants.filter(activeRegistration).length} registered / {selected.capacity ?? 'No limit'} capacity · {selected.registrants.filter(reg => reg.status === 'waitlisted' || reg.status === 'waitlist').length} waiting</p>
        {selected.age_range && <p>Ages: {selected.age_range}</p>}{selected.caregiver_participation && <p>Caregiver participation: {selected.caregiver_participation}</p>}
        {selected.instructor_note && <div className={styles.note}><h3>Owner’s class notes</h3><p>{selected.instructor_note}</p></div>}
        <h3>Children & attendance</h3>
        {!selected.registrants.length ? <p>No registrations yet.</p> : selected.registrants.map(reg => {
          const history = items.filter(item => item.title === selected.title && new Date(item.start_time) < new Date(selected.start_time)).flatMap(item => item.registrants.filter(prev => prev.person_id === reg.person_id).map(prev => ({ date: item.start_time, status: prev.attendance_status })));
          return <article className={styles.child} key={reg.id}><div><strong>{reg.name}</strong><p>{reg.age === null ? 'Age not provided' : `Age ${reg.age}`} · {reg.status}</p></div>
            <label>Attendance <select aria-label={`Attendance for ${reg.name}`} value={reg.attendance_status} disabled={Boolean(saving) || selected.status === 'cancelled' || !activeRegistration(reg) || reg.attendance_status === 'cancelled'} onChange={e => void mark(reg, e.target.value)}><option value="unknown">Not marked</option><option value="attended">Present</option><option value="no_show">Absent</option>{reg.attendance_status === 'cancelled' && <option value="cancelled">Cancelled</option>}</select></label>
            {saving === reg.id && <span role="status">Saving…</span>}
            <details><summary>Previous attendance ({history.length})</summary>{history.length ? history.sort((a,b) => b.date.localeCompare(a.date)).map(prev => <p key={prev.date}>{dateLabel(prev.date)} · {attendanceLabels[prev.status] ?? prev.status}</p>) : <p>No earlier attendance for this class in your assigned sessions.</p>}</details>
          </article>;
        })}
      </section>}
      </>}
    </>}
    <nav className={styles.bottom}><Link href="/">Main</Link><Link href="/teaching">Teaching</Link>{!isKiosk && <><Link href="/landing/classschedule">My Classes</Link><Link href="/landing/party">My Parties</Link></>}{canUseOwnerDashboard && <Link href="/staff">{isStaff ? 'Staff Tool' : 'Owner Tool'}</Link>}</nav>
  </main>;
}
