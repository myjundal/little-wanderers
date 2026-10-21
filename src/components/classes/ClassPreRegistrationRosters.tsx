'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { filterClassRosters, groupClassRosters, type RosterSession } from '@/lib/class-rosters';
import styles from './class-rosters.module.css';

export function ClassViewSwitcher({ value, onChange }: { value: 'rosters' | 'sessions'; onChange: (value: 'rosters' | 'sessions') => void }) {
  return <nav className={styles.viewTabs} aria-label="Class view">
    <button type="button" aria-pressed={value === 'rosters'} onClick={() => onChange('rosters')}>Pre-registration rosters</button>
    <button type="button" aria-pressed={value === 'sessions'} onClick={() => onChange('sessions')}>Schedule & attendance</button>
  </nav>;
}

function dateLabel(value: string) {
  return new Date(value).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function ClassPreRegistrationRosters({ sessions, onSessionSelect, onRefresh, showFamilyLinks = false }: {
  sessions: RosterSession[];
  onSessionSelect?: (id: string) => void;
  onRefresh: () => void | Promise<void>;
  showFamilyLinks?: boolean;
}) {
  const [scope, setScope] = useState<'upcoming' | 'all'>('all');
  const [search, setSearch] = useState('');
  const [classKey, setClassKey] = useState('');
  const rosters = useMemo(() => groupClassRosters(sessions, scope), [sessions, scope]);
  const selectedKey = rosters.some(roster => roster.key === classKey) ? classKey : '';
  const visible = useMemo(() => filterClassRosters(rosters, search, selectedKey), [rosters, search, selectedKey]);
  const total = rosters.reduce((count, roster) => count + roster.children.length, 0);
  const shown = visible.reduce((count, roster) => count + roster.children.length, 0);
  const showAges = sessions.some(session => session.registrations.some(reg => reg.age !== undefined));
  const renderDate = (date: { sessionId: string; startTime: string }, name: string) => onSessionSelect
    ? <button type="button" className={styles.dateButton} onClick={() => onSessionSelect(date.sessionId)} aria-label={`Open ${name}’s session on ${dateLabel(date.startTime)}`}>{dateLabel(date.startTime)}</button>
    : <span>{dateLabel(date.startTime)}</span>;

  return <section className={styles.panel} aria-labelledby="preregistration-rosters-heading">
    <div className={styles.heading}>
      <div><h2 id="preregistration-rosters-heading">Class pre-registration rosters</h2><p>One list per class, across dates. Each child appears once per class.</p></div>
      <button type="button" className={styles.button} onClick={() => void onRefresh()}>Refresh list</button>
    </div>
    <p className={styles.note}>Pre-registration records interest. A place is confirmed only after official registration opens and payment is completed.</p>
    <div className={styles.filters}>
      <label className={styles.search}>Search class or child<input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Class or child’s name" /></label>
      <label>Show dates<select value={scope} onChange={event => setScope(event.target.value as 'upcoming' | 'all')}><option value="upcoming">Upcoming dates</option><option value="all">All dates</option></select></label>
    </div>
    <div className={styles.classChoices} aria-label="Filter by class">
      <button type="button" aria-pressed={!selectedKey} onClick={() => setClassKey('')}>All classes <span>{total}</span></button>
      {rosters.map(roster => <button type="button" key={roster.key} aria-pressed={selectedKey === roster.key} onClick={() => setClassKey(roster.key)}>{roster.title} <span>{roster.children.length}</span></button>)}
    </div>
    <p className={styles.results} role="status">{shown} class pre-registration{shown === 1 ? '' : 's'} across {visible.length} class{visible.length === 1 ? '' : 'es'}.</p>
    {!rosters.length ? <p className={styles.empty}>{scope === 'upcoming' ? 'No upcoming classes. Choose All dates to view earlier records.' : 'No classes available.'}</p>
      : !visible.length ? <p className={styles.empty}>No matching classes or children. Try another name or choose All classes.</p>
      : <div className={styles.courseList}>{visible.map(roster => <article key={roster.key} className={styles.course}>
        <header className={styles.courseHeading}><div><h3>{roster.title}</h3>{roster.scheduleLabels.length > 0 && <p>{roster.scheduleLabels.join(' · ')}</p>}</div><strong>{roster.children.length} child{roster.children.length === 1 ? '' : 'ren'}</strong></header>
        {!roster.children.length ? <p className={styles.empty}>No active pre-registrations for this class.</p>
          : <div className={styles.tableWrap}><table className={styles.table}>
            <caption className={styles.srOnly}>{roster.title} pre-registration roster</caption>
            <thead><tr><th scope="col">Child</th>{showAges && <th scope="col">Age</th>}<th scope="col">Selected dates</th></tr></thead>
            <tbody>{roster.children.map(child => <tr key={child.personId}>
              <td data-label="Child"><strong>{child.name}</strong>{showFamilyLinks && child.householdId && <Link className={styles.familyLink} href={`/staff/families/${encodeURIComponent(child.householdId)}`}>View family</Link>}</td>
              {showAges && <td data-label="Age">{child.age == null ? 'Not provided' : `${child.age} ${child.age === 1 ? 'year' : 'years'}`}</td>}
              <td data-label="Selected dates">{child.dates.length === 1
                ? renderDate(child.dates[0], child.name)
                : <details><summary>{child.dates.length} selected dates</summary><ul className={styles.dates}>{child.dates.map(date => <li key={date.sessionId}>{renderDate(date, child.name)}</li>)}</ul></details>}
              </td>
            </tr>)}</tbody>
          </table></div>}
      </article>)}</div>}
  </section>;
}
