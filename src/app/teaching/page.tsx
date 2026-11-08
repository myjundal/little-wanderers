'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import ClassCheckIn from '@/components/classes/ClassCheckIn';
import { useOperatorAccess } from '@/lib/use-owner-dashboard-access';
import StaffToolNav from '@/components/staff/StaffToolNav';
import styles from './teaching.module.css';
type TeachingClass = { id: string; title: string; start_time: string; end_time: string; status: string; schedule_label: string | null; instructor_note: string | null; registrants: Array<{ id: string; person_id: string; name: string; age: number | null; status: string; attendance_status: string }> };
export default function TeachingPage() {
  const { canUseOwnerDashboard, isKiosk } = useOperatorAccess();
  const [items, setItems] = useState<TeachingClass[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/teaching', { cache: 'no-store' }); const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Unable to load your classes.');
      setItems(data.items); setError('');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to load your classes.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  return <main className={styles.main}>
    <div className={styles.heading}><div><p>Little Wanderers</p><h1>My teaching classes</h1><p>View your assigned classes and check in confirmed children.</p></div>{canUseOwnerDashboard ? <StaffToolNav includePersonal={!isKiosk} /> : <nav className={styles.links}><Link href="/">Homepage</Link>{!isKiosk && <Link href="/landing">My account</Link>}</nav>}</div>
    {error && <p role="alert" className={styles.error}>{error} <button onClick={() => void load()}>Retry</button></p>}
    {loading ? <p>Loading your classes…</p> : !items.length ? <section className={styles.card}><h2>No classes assigned yet</h2><p>Your classes appear here when the owner assigns your account.</p></section> : <ClassCheckIn onRefresh={load} sessions={items.map(item => ({ id: item.id, title: item.title, startTime: item.start_time, endTime: item.end_time, status: item.status, scheduleLabel: item.schedule_label, instructorNote: item.instructor_note, registrations: item.registrants.map(reg => ({ id: reg.id, personId: reg.person_id, name: reg.name, age: reg.age, status: reg.status, attendanceStatus: reg.attendance_status })) }))} />}
  </main>;
}
