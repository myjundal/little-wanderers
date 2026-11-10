'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import styles from '@/components/membership/founding.module.css';
import MembershipManagementSummary from '@/components/staff/MembershipManagementSummary';
import StaffToolNav from '@/components/staff/StaffToolNav';
import { MEMBERSHIP_MANAGEMENT_LABELS } from '@/lib/membership-summary';
import { easternDate, type MembershipPhase, type MembershipTier } from '@/lib/founding-membership';

type Item = { id: string; status: string; pricing_tier: MembershipTier; base_cents: number; sibling_cents: number; amount_cents: number; start_date: string | null; card_last4: string | null; household: { name: string; email: string; phone: string } };

export default function FoundingMembershipsPage() {
  const [summaryRefresh, setSummaryRefresh] = useState(0);
  const [items, setItems] = useState<Item[]>([]);
  const [billingEnabled, setBillingEnabled] = useState(false);
  const [phase, setPhase] = useState<MembershipPhase>('waitlist');
  const [nextPhase, setNextPhase] = useState<MembershipPhase>('waitlist');
  const [startDate, setStartDate] = useState('');
  const [selected, setSelected] = useState<Item | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [firstVisitConfirmed, setFirstVisitConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const response = await fetch('/api/admin/founding-memberships', { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    setItems(data.items); setBillingEnabled(data.billing_enabled); setPhase(data.phase); setNextPhase(data.phase); setSummaryRefresh(value => value + 1);
  }, []);
  useEffect(() => { void load().catch(err => setError(err.message)); }, [load]);

  async function savePhase() {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const response = await fetch('/api/admin/founding-memberships', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phase: nextPhase, previousPhase: phase }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to update enrollment phase.'); }
    finally { setBusy(false); }
  }

  async function activate() {
    if (!selected || busy || !startDate || !firstVisitConfirmed || confirmation !== 'START MONTHLY BILLING') return;
    setBusy(true); setError(null);
    try {
      const response = await fetch('/api/admin/founding-memberships', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: selected.id, startDate, confirmation, firstVisitConfirmed }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setSelected(null); setConfirmation(''); setFirstVisitConfirmed(false); setStartDate(''); await load();
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to start membership.'); }
    finally { setBusy(false); }
  }

  return <main className={styles.page}>
    <StaffToolNav active="memberships" includeMembershipManagement />
    <p className={styles.eyebrow}>Owner · Memberships</p><h1>Membership management</h1>
    <MembershipManagementSummary refreshKey={summaryRefresh} />
    <p><Link href="/founding-membership">View the private enrollment page</Link></p>
    <section className={styles.formCard} style={{ marginBottom: 24 }}><h2>Enrollment phase</h2><p>Current: <strong>{phase === 'waitlist' ? 'Wanderlist first' : phase === 'public' ? 'General Founding' : 'General'}</strong>. Existing members keep the rates saved at enrollment. Canceled members rejoin at $60 + $20.</p><label htmlFor="membership-phase">Offer for new members<select id="membership-phase" value={nextPhase} disabled={busy} onChange={event => setNextPhase(event.target.value as MembershipPhase)} style={{ display: 'block', padding: 12, margin: '12px 0', maxWidth: '100%' }}><option value="waitlist">1. Wanderlist only · $50 + $10</option><option value="public">2. General Founding · $50 + $20 (Wanderlist stays $50 + $10)</option><option value="regular">3. After opening · $60 + $20</option></select></label><button className={styles.secondary} disabled={busy || nextPhase === phase} onClick={savePhase}>Save enrollment phase</button><p className={styles.small}>Changing this offer does not set a billing start date, start billing, or change existing members’ rates.</p></section>
    <div className={styles.notice}><strong>{billingEnabled ? 'Billing is enabled for explicit owner activation.' : 'Billing is disabled. Cards only; no subscriptions or charges.'}</strong><p>Start each family separately on its first membership visit, including during soft opening. Confirm the family has arrived, enter that day’s date, and activate that family explicitly. Soft opening visits have no separate admission charge. Saving a card or checking in does not start billing automatically.</p></div>
    <div style={{ display: 'grid', gap: 16, marginTop: 24 }}>{items.map(item => <article key={item.id} className={styles.formCard}>
      <h2>{item.household?.name || 'Family'}</h2><p>{item.household?.email} · {item.household?.phone}</p><p>Status: <strong>{item.status}</strong>{item.card_last4 ? ` · Card ending ${item.card_last4}` : ''}</p><p>{MEMBERSHIP_MANAGEMENT_LABELS[item.pricing_tier]}: ${item.base_cents / 100} first child + ${item.sibling_cents / 100} per eligible sibling.</p><p>Estimate at enrollment: ${item.amount_cents / 100}/month. Sibling ages are recalculated at activation.</p>
      {item.start_date && <p>Billing start: {item.start_date}</p>}
      {['pending', 'activating'].includes(item.status) && <button className={styles.secondary} disabled={!billingEnabled || busy} onClick={() => { setSelected(item); setStartDate(item.status === 'activating' ? item.start_date || '' : ''); setConfirmation(''); setFirstVisitConfirmed(false); }}>Review billing activation</button>}
    </article>)}</div>
    {selected && <section className={styles.formCard} style={{ marginTop: 24 }}><h2>Start monthly billing for {selected.household?.name}</h2><p>This creates a Square subscription and can charge the saved card today. First-child rate: ${selected.base_cents / 100}/month; each eligible sibling: ${selected.sibling_cents / 100}/month.</p><label htmlFor="first-visit-date">This family’s first membership visit date<input id="first-visit-date" type="date" value={startDate} min={selected.status === 'activating' ? selected.start_date || easternDate() : easternDate()} max={selected.status === 'activating' ? selected.start_date || easternDate() : easternDate()} disabled={busy || selected.status === 'activating'} onChange={e => setStartDate(e.target.value)} style={{ display: 'block', padding: 12, margin: '14px 0' }} /></label><label className={styles.checkbox}><input type="checkbox" checked={firstVisitConfirmed} disabled={busy} onChange={e => setFirstVisitConfirmed(e.target.checked)} /><span>{selected.status === 'activating' ? 'I confirm this is a retry for the family’s already-confirmed first membership visit.' : 'I confirm this family has arrived for its first membership visit today, including a soft opening visit.'}</span></label><label htmlFor="billing-confirm">Type START MONTHLY BILLING<input id="billing-confirm" value={confirmation} onChange={e => setConfirmation(e.target.value)} style={{ display: 'block', padding: 12, margin: '14px 0', maxWidth: '100%' }} /></label><button className={styles.primary} disabled={busy || !startDate || !firstVisitConfirmed || confirmation !== 'START MONTHLY BILLING'} onClick={activate}>{busy ? 'Starting…' : 'Start this family’s monthly billing'}</button><button className={styles.textButton} disabled={busy} onClick={() => setSelected(null)}>Go back</button></section>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
  </main>;
}
