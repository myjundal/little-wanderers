'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import styles from '@/components/membership/founding.module.css';
import { MEMBERSHIP_PRICES, type MembershipPhase, type MembershipTier } from '@/lib/founding-membership';

type Item = { id: string; status: string; pricing_tier: MembershipTier; base_cents: number; sibling_cents: number; amount_cents: number; start_date: string | null; card_last4: string | null; household: { name: string; email: string; phone: string } };

export default function FoundingMembershipsPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [billingEnabled, setBillingEnabled] = useState(false);
  const [phase, setPhase] = useState<MembershipPhase>('waitlist');
  const [nextPhase, setNextPhase] = useState<MembershipPhase>('waitlist');
  const [startDate, setStartDate] = useState('');
  const [selected, setSelected] = useState<Item | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const response = await fetch('/api/admin/founding-memberships', { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    setItems(data.items); setBillingEnabled(data.billing_enabled); setPhase(data.phase); setNextPhase(data.phase);
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
    if (!selected || busy || !startDate || confirmation !== 'START MONTHLY BILLING') return;
    setBusy(true); setError(null);
    try {
      const response = await fetch('/api/admin/founding-memberships', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: selected.id, startDate, confirmation }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setSelected(null); setConfirmation(''); await load();
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to start membership.'); }
    finally { setBusy(false); }
  }

  return <main className={styles.page}>
    <p className={styles.eyebrow}>Owner · Founding families</p><h1>Founding memberships</h1>
    <p><Link href="/founding-membership">View the private enrollment page</Link></p>
    <section className={styles.formCard} style={{ marginBottom: 24 }}><h2>Enrollment phase</h2><p>Current: <strong>{phase === 'waitlist' ? 'Wanderlist first' : phase === 'public' ? 'Public founding' : 'Regular pricing'}</strong>. Existing members keep the rates saved at enrollment. Canceled members rejoin at $60 + $20.</p><label htmlFor="membership-phase">Offer for new members<select id="membership-phase" value={nextPhase} disabled={busy} onChange={event => setNextPhase(event.target.value as MembershipPhase)} style={{ display: 'block', padding: 12, margin: '12px 0', maxWidth: '100%' }}><option value="waitlist">1. Wanderlist only · $50 + $10</option><option value="public">2. Public founding · $50 + $20 (Wanderlist stays $50 + $10)</option><option value="regular">3. After opening · $60 + $20</option></select></label><button className={styles.secondary} disabled={busy || nextPhase === phase} onClick={savePhase}>Save enrollment phase</button><p className={styles.small}>Changing this offer does not set an opening date, start billing, or change existing members’ rates.</p></section>
    <div className={styles.notice}><strong>{billingEnabled ? 'Billing is enabled for explicit owner activation.' : 'Billing is disabled. Cards only; no subscriptions or charges.'}</strong><p>The opening date has no default. On the actual opening day, enter its date and activate each reserved family explicitly. There is no scheduled billing job.</p></div>
    <label htmlFor="opening-date">Confirmed opening date<input id="opening-date" type="date" value={startDate} disabled={!billingEnabled || busy} onChange={e => setStartDate(e.target.value)} style={{ display: 'block', margin: '12px 0', padding: 12 }} /></label>
    <div style={{ display: 'grid', gap: 16, marginTop: 24 }}>{items.map(item => <article key={item.id} className={styles.formCard}>
      <h2>{item.household?.name || 'Family'}</h2><p>{item.household?.email} · {item.household?.phone}</p><p>Status: <strong>{item.status}</strong>{item.card_last4 ? ` · Card ending ${item.card_last4}` : ''}</p><p>{MEMBERSHIP_PRICES[item.pricing_tier].label}: ${item.base_cents / 100} first child + ${item.sibling_cents / 100} per eligible sibling.</p><p>Estimate at enrollment: ${item.amount_cents / 100}/month. Sibling ages are recalculated at activation.</p>
      {item.start_date && <p>Billing start: {item.start_date}</p>}
      {['pending', 'activating'].includes(item.status) && <button className={styles.secondary} disabled={!billingEnabled || !startDate || busy} onClick={() => { setSelected(item); setConfirmation(''); }}>Review billing activation</button>}
    </article>)}</div>
    {selected && <section className={styles.formCard} style={{ marginTop: 24 }}><h2>Start monthly billing for {selected.household?.name}</h2><p>This creates a Square subscription and can charge the saved card today. First-child rate: ${selected.base_cents / 100}/month; each eligible sibling: ${selected.sibling_cents / 100}/month.</p><p>Explicit start date: <strong>{startDate}</strong></p><label htmlFor="billing-confirm">Type START MONTHLY BILLING<input id="billing-confirm" value={confirmation} onChange={e => setConfirmation(e.target.value)} style={{ display: 'block', padding: 12, margin: '14px 0', maxWidth: '100%' }} /></label><button className={styles.primary} disabled={busy || confirmation !== 'START MONTHLY BILLING'} onClick={activate}>{busy ? 'Starting…' : 'Start this family’s monthly billing'}</button><button className={styles.textButton} disabled={busy} onClick={() => setSelected(null)}>Go back</button></section>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
  </main>;
}
