'use client';
import PartyPrivacyEditor from '@/components/staff/PartyPrivacyEditor';
import { PARTY_PRIVACY_UPDATED_EVENT } from '@/lib/private-party-open-play';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import PartyGuestWaivers from '@/components/waivers/PartyGuestWaivers';
import PartyScheduleEditor, { type PartySchedule } from '@/components/staff/PartyScheduleEditor';
import { getPartyDateKey, PARTY_TIME_ZONE } from '@/lib/party-config';
import { PARTY_SCHEDULE_UPDATED_EVENT } from '@/lib/party-management';
import styles from './party-management.module.css';

type Party = {
  id: string;
  household_id: string;
  household_name: string;
  household_email: string | null;
  start_time: string;
  end_time: string;
  room: string | null;
  is_private: boolean;
  headcount_expected: number | null;
  birthday_child_name: string | null;
  birthday_age: number | null;
  occasion_details: string | null;
  current_child_count: number;
  current_adult_count: number;
  final_child_count: number | null;
  final_adult_count: number | null;
  final_total_count: number | null;
  attendance_finalized_at: string | null;
};

const time = (value: string) => new Date(value).toLocaleTimeString('en-US', { timeZone: PARTY_TIME_ZONE, hour: 'numeric', minute: '2-digit' });

export default function PartyManagement({ canEditSchedule = false }: { canEditSchedule?: boolean }) {
  const [parties, setParties] = useState<Party[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [date, setDate] = useState('');
  const [loading, setLoading] = useState(true);
  const [available, setAvailable] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const saving = useRef(false);
  const revision = useRef(0);

  const load = useCallback(async (signal?: AbortSignal) => {
    if (saving.current) return;
    const request = ++revision.current;
    try {
      const response = await fetch('/api/admin/party-bookings?today=1', { cache: 'no-store', signal });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || 'Unable to load today’s parties.');
      if (signal?.aborted || request !== revision.current) return;
      const items = result.items as Party[];
      setParties(items);
      setDate(result.date);
      setAvailable(result.attendance_available !== false);
      setSelectedId(previous => items.some(item => item.id === previous) ? previous : (items.find(item => new Date(item.end_time).getTime() > Date.now()) ?? items[0])?.id ?? '');
      setError('');
    } catch (cause) {
      if (!signal?.aborted && request === revision.current) setError(cause instanceof Error ? cause.message : 'Unable to load today’s parties.');
    } finally {
      if (!signal?.aborted && request === revision.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    const timer = window.setInterval(() => void load(controller.signal), 30000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [load]);

  useEffect(() => {
    const syncSchedule = (event: Event) => {
      const item = (event as CustomEvent<PartySchedule>).detail;
      ++revision.current;
      setParties(previous => previous.map(party => party.id === item.id ? { ...party, ...item } : party)
        .filter(party => getPartyDateKey(party.start_time) === date)
        .sort((a, b) => Date.parse(a.start_time) - Date.parse(b.start_time)));
    };
    window.addEventListener(PARTY_SCHEDULE_UPDATED_EVENT, syncSchedule);
    window.addEventListener(PARTY_PRIVACY_UPDATED_EVENT, syncSchedule);
    return () => { window.removeEventListener(PARTY_SCHEDULE_UPDATED_EVENT, syncSchedule); window.removeEventListener(PARTY_PRIVACY_UPDATED_EVENT, syncSchedule); };
  }, [date]);

  const selected = parties.find(item => item.id === selectedId) ?? parties[0];
  async function update(action: string) {
    if (!selected || saving.current) return;
    saving.current = true;
    ++revision.current;
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch(`/api/admin/party-bookings/${selected.id}/headcount`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || 'Unable to save attendance. Refresh before trying again.');
      setParties(previous => previous.map(item => item.id === selected.id ? { ...item, ...result.item } : item));
      setMessage(action === 'finalize' ? 'Final attendance saved.' : action === 'reopen' ? 'Attendance reopened.' : 'Attendance saved.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to save attendance. Refresh before trying again.');
    } finally { saving.current = false; setBusy(false); }
  }

  const finalized = Boolean(selected?.attendance_finalized_at);
  const children = Number(selected?.current_child_count ?? 0);
  const adults = Number(selected?.current_adult_count ?? 0);
  const dateLabel = date ? new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: PARTY_TIME_ZONE, weekday: 'long', month: 'long', day: 'numeric' }) : '';

  return <section className={styles.management} aria-label="Today’s parties">
    <div className={styles.heading}>
      <div><h2>Today’s parties</h2><p>{dateLabel} · Eastern Time</p></div>
      <button type="button" disabled={busy} onClick={() => void load()}>Refresh parties</button>
    </div>
    {error && <p className={styles.alert} role="alert">{error}</p>}
    <p className={styles.feedback} role="status" aria-live="polite">{busy ? 'Saving attendance…' : message}</p>
    {loading ? <p>Loading today’s parties…</p> : !parties.length ? <div className={styles.card}><h3>No confirmed parties today</h3><p>Today’s confirmed parties will appear here with their waiver QR and attendance counters.</p></div> : <>
      <div className={styles.tabs} aria-label="Choose a party">
        {parties.map(party => <button type="button" key={party.id} disabled={busy} aria-pressed={party.id === selected?.id} onClick={() => { setSelectedId(party.id); setError(''); setMessage(''); }}>
          <strong>{time(party.start_time)} – {time(party.end_time)}</strong><span>{party.birthday_child_name || party.household_name}</span>
        </button>)}
      </div>
      {selected && <div className={styles.workspace}>
        <div className={styles.card}>
          <p className={styles.eyebrow}>Party details</p>
          <h3>{selected.birthday_child_name ? `${selected.birthday_child_name}’s party` : selected.household_name}</h3>
          <p className={styles.time}>{time(selected.start_time)} – {time(selected.end_time)}</p>
          {canEditSchedule && new Date(selected.end_time).getTime() > Date.now() && <PartyScheduleEditor
            key={`${selected.id}:${selected.start_time}:${selected.end_time}`}
            booking={selected}
            disabled={busy}
            onSaved={item => {
              setMessage(getPartyDateKey(item.start_time) === date ? 'Party date and time saved.' : 'Party moved to the new date. Find it under All bookings & requests.');
            }}
          />}
          {canEditSchedule && new Date(selected.end_time).getTime() > Date.now() && <PartyPrivacyEditor key={`privacy:${selected.id}:${selected.start_time}`} booking={selected} disabled={busy} />}
          {!canEditSchedule && selected.is_private && <p><strong>Private party · Open Play ends at 4pm</strong></p>}
          <dl className={styles.details}>
            <div><dt>Host family</dt><dd><Link href={`/staff/families/${selected.household_id}`}>{selected.household_name}</Link></dd></div>
            <div><dt>Parent email</dt><dd>{selected.household_email ? <a href={`mailto:${selected.household_email}`}>{selected.household_email}</a> : 'Not provided'}</dd></div>
            <div><dt>Room</dt><dd>{selected.room || 'Party room'}</dd></div>
            <div><dt>Expected guests</dt><dd>{selected.headcount_expected ?? 'Not provided'}</dd></div>
            {selected.birthday_age != null && <div><dt>Birthday age</dt><dd>{selected.birthday_age}</dd></div>}
          </dl>
          {selected.occasion_details && <p className={styles.occasion}>{selected.occasion_details}</p>}
          <div className={styles.attendance}>
            <h3>Attendance</h3>
            <p>Tap + as each guest arrives. Count children and adults separately.</p>
            {!available && <p role="alert">Attendance is temporarily unavailable. Please contact the owner.</p>}
            <div className={styles.counters}>
              {([{ label: 'Children', count: children, key: 'child' }, { label: 'Adults', count: adults, key: 'adult' }] as const).map(counter => <div className={styles.counter} key={counter.key}>
                <h4>{counter.label}</h4><output aria-label={`${counter.label} present`}>{counter.count}</output>
                <div><button type="button" aria-label={`Remove one ${counter.key}`} disabled={busy || finalized || !available || counter.count === 0} onClick={() => void update(`decrement_${counter.key}`)}>−</button><button type="button" aria-label={`Add one ${counter.key}`} disabled={busy || finalized || !available} onClick={() => void update(`increment_${counter.key}`)}>+</button></div>
              </div>)}
            </div>
            <p className={styles.total}>Total present <strong>{children + adults}</strong></p>
            {finalized ? <div className={styles.finalized}><p><strong>Final attendance: {selected.final_total_count}</strong><br />{selected.final_child_count} children · {selected.final_adult_count} adults</p><button type="button" disabled={busy || !available} onClick={() => void update('reopen')}>Reopen attendance</button></div> : <button className={styles.finalize} type="button" disabled={busy || !available} onClick={() => void update('finalize')}>Finalize attendance</button>}
          </div>
        </div>
        <div className={styles.waivers} key={selected.id}><PartyGuestWaivers partyId={selected.id} /></div>
      </div>}
    </>}
  </section>;
}
