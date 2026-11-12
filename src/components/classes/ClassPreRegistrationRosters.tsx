'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { classRosterWeekStart, filterWeeklyClassRosters, groupWeeklyClassRosters, shiftRosterDate, type RosterRegistration, type RosterSession } from '@/lib/class-rosters';
import styles from './class-rosters.module.css';

export function ClassViewSwitcher({ value, onChange }: { value: 'rosters' | 'sessions'; onChange: (value: 'rosters' | 'sessions') => void }) {
  return <nav className={styles.viewTabs} aria-label="Class view">
    <button type="button" aria-pressed={value === 'rosters'} onClick={() => onChange('rosters')}>Weekly rosters</button>
    <button type="button" aria-pressed={value === 'sessions'} onClick={() => onChange('sessions')}>Schedule & attendance</button>
  </nav>;
}

function dayLabel(date: string) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
}

function timeLabel(value: string) {
  return new Date(value).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
}

export default function ClassPreRegistrationRosters({ sessions, onSessionSelect, onRefresh, showFamilyLinks = false }: {
  sessions: RosterSession[];
  onSessionSelect?: (id: string) => void;
  onRefresh: () => void | Promise<void>;
  showFamilyLinks?: boolean;
}) {
  const [weekStart, setWeekStart] = useState(() => classRosterWeekStart());
  const [search, setSearch] = useState('');
  const [classTitle, setClassTitle] = useState('');
  const days = useMemo(() => groupWeeklyClassRosters(sessions, weekStart), [sessions, weekStart]);
  const classTitles = useMemo(() => [...new Set(sessions.filter(session => session.status !== 'cancelled').map(session => session.title))].sort(), [sessions]);
  const visible = useMemo(() => filterWeeklyClassRosters(days, search, classTitle), [days, search, classTitle]);
  const weekSessions = visible.flatMap(day => day.sessions);
  const confirmedCount = weekSessions.reduce((count, session) => count + session.confirmed.length, 0);
  const interestedCount = weekSessions.reduce((count, session) => count + session.interested.length, 0);
  const showAges = sessions.some(session => session.registrations.some(reg => reg.age !== undefined));

  const renderGroup = (label: string, registrations: RosterRegistration[], title: string, confirmed: boolean) => <details className={`${styles.registrationGroup} ${confirmed ? styles.confirmed : styles.interested}`}>
    <summary>{label} ({registrations.length})</summary>
    {!registrations.length ? <p className={styles.empty}>{confirmed ? 'No confirmed seats for this date.' : 'No interested children for this date.'}</p>
      : <div className={styles.tableWrap}><table className={styles.table}>
        <caption className={styles.srOnly}>{title} — {label}</caption>
        <thead><tr><th scope="col">Child</th>{showAges && <th scope="col">Age</th>}</tr></thead>
        <tbody>{registrations.map(child => <tr key={child.personId || child.id}>
          <td data-label="Child"><strong>{child.name}</strong>{showFamilyLinks && child.householdId && <Link className={styles.familyLink} href={`/staff/families/${encodeURIComponent(child.householdId)}`}>View family</Link>}</td>
          {showAges && <td data-label="Age">{child.age == null ? 'Not provided' : `${child.age} ${child.age === 1 ? 'year' : 'years'}`}</td>}
        </tr>)}</tbody>
      </table></div>}
  </details>;

  return <section className={styles.panel} aria-labelledby="preregistration-rosters-heading">
    <div className={styles.heading}>
      <div><h2 id="preregistration-rosters-heading">Weekly class rosters</h2><p>View confirmed seats and interest separately for each class date.</p></div>
      <button type="button" className={styles.button} onClick={() => void onRefresh()}>Refresh list</button>
    </div>
    <p className={styles.note}>Seat confirmed shows confirmed registrations. Interested includes pre-registration and waiting lists; these do not reserve a seat. Counts are per class date.</p>
    <nav className={styles.weekNav} aria-label="Roster week">
      <button type="button" className={styles.button} onClick={() => setWeekStart(shiftRosterDate(weekStart, -7))}>Previous week</button>
      <strong className={styles.weekRange}>{dayLabel(weekStart)} – {dayLabel(shiftRosterDate(weekStart, 6))}</strong>
      <button type="button" className={styles.button} onClick={() => setWeekStart(shiftRosterDate(weekStart, 7))}>Next week</button>
      <label className={styles.weekPicker}>Choose week<input type="date" value={weekStart} onChange={event => { if (/^\d{4}-\d{2}-\d{2}$/.test(event.target.value)) setWeekStart(classRosterWeekStart(event.target.value)); }} /></label>
      <button type="button" className={styles.button} onClick={() => setWeekStart(classRosterWeekStart())}>This week</button>
    </nav>
    <div className={styles.filters}>
      <label className={styles.search}>Search class or child<input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Class or child’s name" /></label>
      <label>Class<select value={classTitle} onChange={event => setClassTitle(event.target.value)}><option value="">All classes</option>{classTitles.map(title => <option key={title} value={title}>{title}</option>)}</select></label>
    </div>
    <p className={styles.results} role="status">{weekSessions.length} class session{weekSessions.length === 1 ? '' : 's'} · Seat confirmed ({confirmedCount}) · Interested ({interestedCount}) · All times Eastern</p>
    {!visible.length ? <p className={styles.empty}>{days.length ? 'No matching classes or children this week. Try another name or choose All classes.' : 'No classes this week. Choose another week to view rosters.'}</p>
      : <div className={styles.dayList}>{visible.map(day => <section key={day.date} aria-label={dayLabel(day.date)}>
        <h3 className={styles.dayHeading}>{dayLabel(day.date)}</h3>
        <div className={styles.courseList}>{day.sessions.map(session => <article key={session.id} className={styles.course}>
          <header className={styles.courseHeading}>
            <div><h4>{session.title}</h4><p>{timeLabel(session.startTime)} – {timeLabel(session.endTime)} ET{session.scheduleLabel ? ` · ${session.scheduleLabel}` : ''}</p></div>
            {onSessionSelect && <button type="button" className={styles.button} onClick={() => onSessionSelect(session.id)} aria-label={`Open ${session.title} session on ${dayLabel(day.date)}`}>Open session</button>}
          </header>
          <div className={styles.registrationGroups}>
            {renderGroup('Seat confirmed', session.confirmed, session.title, true)}
            {renderGroup('Interested', session.interested, session.title, false)}
          </div>
        </article>)}</div>
      </section>)}</div>}
  </section>;
}
