'use client';

import { useEffect, useState } from 'react';
import type { AdmissionVisit } from '@/lib/admission-pos-ui';
import { admissionTime, stayLabel, stayMinutes, visitingFamilies } from '@/lib/admission-stays';
import styles from './admission-visits.module.css';

type Props = {
  visits: AdmissionVisit[];
  ready: boolean;
  locked: boolean;
  checkingOut: string;
  onCheckout: (householdId: string, ids: string[]) => void;
  onOpenFamily: (householdId: string) => void;
  onRefresh: () => void;
};

export default function AdmissionVisits({ visits, ready, locked, checkingOut, onCheckout, onOpenFamily, onRefresh }: Props) {
  const [now, setNow] = useState(() => new Date().toISOString());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date().toISOString()), 60000);
    return () => window.clearInterval(timer);
  }, []);
  const groups = visitingFamilies(visits);
  const active = groups.filter(group => group.visits.some(visit => !visit.checked_out_at));
  const departed = groups.filter(group => group.visits.every(visit => !!visit.checked_out_at));

  return <section className={styles.panel} aria-label="Checked-in families" id="checked-in-families">
    <div className={styles.heading}>
      <div><h2>Checked-in families</h2><p>{active.length} {active.length === 1 ? 'family' : 'families'} · {visits.filter(visit => !visit.checked_out_at).length} guests here now</p></div>
      <button type="button" disabled={locked} onClick={onRefresh}>Refresh visitors</button>
    </div>
    {!ready && <p role="status">Refresh admission status to see the current visitor list.</p>}
    {ready && !active.length && <p>No families are currently checked in.</p>}
    <div className={styles.cards}>
      {active.map(group => {
        const current = group.visits.filter(visit => !visit.checked_out_at);
        const due = group.visits.filter(visit => visit.payment_status === 'due').reduce((sum, visit) => sum + visit.price_cents, 0);
        return <article key={group.id} className={styles.activeCard}>
          <h3>{group.name}</h3>
          <p className={styles.inLabel}>Checked in · {current.length} guest{current.length === 1 ? '' : 's'}</p>
          <ul>{group.visits.map(visit => <li key={visit.id}><strong>{visit.name}</strong><br />
            {visit.checked_in_at ? <>In {admissionTime(visit.checked_in_at)} · {visit.checked_out_at ? `Out ${admissionTime(visit.checked_out_at)} · ` : ''}{stayLabel(stayMinutes(visit.checked_in_at, visit.checked_out_at || now))}{!visit.checked_out_at && ' so far'}</> : 'Arrival time unavailable'}
          </li>)}</ul>
          {due > 0 && <p className={styles.due}>${(due / 100).toFixed(2)} admission due</p>}
          <div className={styles.actions}>
            <button type="button" className={styles.checkout} disabled={locked || !ready} onClick={() => onCheckout(group.id, current.map(visit => visit.id))}>
              {checkingOut === group.id ? 'Recording departure…' : `Check out family (${current.length})`}
            </button>
            <button type="button" disabled={locked} onClick={() => onOpenFamily(group.id)}>Open family / payment</button>
          </div>
        </article>;
      })}
    </div>
    {departed.length > 0 && <details className={styles.departed} open>
      <summary>Checked out today · {departed.length} {departed.length === 1 ? 'family' : 'families'}</summary>
      <div className={styles.cards}>{departed.map(group => <article key={group.id} className={styles.departedCard}>
        <h3>{group.name}</h3>
        <ul>{group.visits.map(visit => <li key={visit.id}>{visit.name} · {visit.checked_in_at && `In ${admissionTime(visit.checked_in_at)} · `}Out {admissionTime(visit.checked_out_at!)} · <strong>{stayLabel(stayMinutes(visit.checked_in_at, visit.checked_out_at))}</strong></li>)}</ul>
        {group.visits.some(visit => visit.payment_status === 'due' && visit.price_cents > 0) && <p className={styles.due}>Admission payment still due</p>}
        <button type="button" disabled={locked} onClick={() => onOpenFamily(group.id)}>Open family / payment</button>
      </article>)}</div>
    </details>}
    <p className={styles.note}>Times are Eastern. Check out the guests who are leaving; this also updates the crowd count.</p>
  </section>;
}
