'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import styles from '@/components/membership/founding.module.css';
import MembershipManagementSummary from '@/components/staff/MembershipManagementSummary';
import StaffToolNav from '@/components/staff/StaffToolNav';
import { MEMBERSHIP_MANAGEMENT_LABELS } from '@/lib/membership-summary';
import { type MembershipPhase, type MembershipTier } from '@/lib/founding-membership';

type Item = { id: string; status: string; pricing_tier: MembershipTier; base_cents: number; sibling_cents: number; amount_cents: number; start_date: string | null; card_last4: string | null; household: { name: string; email: string; phone: string } };

export default function FoundingMembershipsPage() {
  const reviewPanel = useRef<HTMLElement | null>(null);
  const [summaryRefresh, setSummaryRefresh] = useState(0);
  const [items, setItems] = useState<Item[]>([]);
  const [billingEnabled, setBillingEnabled] = useState(false);
  const [phase, setPhase] = useState<MembershipPhase>('waitlist');
  const [nextPhase, setNextPhase] = useState<MembershipPhase>('waitlist');
  const [review, setReview] = useState<{ enrollment_id: string; first_visit_date: string; start_date: string; amount_cents: number; next_billing_date: string; card_last4: string; card_brand: string } | null>(null);
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
  useEffect(() => { if (selected) reviewPanel.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, [selected]);

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

  async function openReview(item: Item) {
    if (busy) return;
    setBusy(true); setError(null); setSelected(item); setReview(null); setConfirmation(''); setFirstVisitConfirmed(false);
    try {
      const response = await fetch(`/api/admin/founding-memberships?review=${encodeURIComponent(item.id)}`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setBillingEnabled(data.billing_enabled); setReview(data.review);
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to review this membership.'); }
    finally { setBusy(false); }
  }

  async function activate() {
    if (!selected || busy || !billingEnabled || !review || !firstVisitConfirmed || confirmation !== 'START MONTHLY BILLING') return;
    setBusy(true); setError(null);
    try {
      const response = await fetch('/api/admin/founding-memberships', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: selected.id, startDate: review.start_date, expectedAmountCents: review.amount_cents, confirmation, firstVisitConfirmed }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setSelected(null); setReview(null); setConfirmation(''); setFirstVisitConfirmed(false); await load();
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to start membership.'); }
    finally { setBusy(false); }
  }

  return <main className={styles.page}>
    <StaffToolNav active="memberships" includeMembershipManagement />
    <p className={styles.eyebrow}>Owner · Memberships</p><h1>Membership management</h1>
    <MembershipManagementSummary refreshKey={summaryRefresh} />
    <p><Link href="/founding-membership">View the private enrollment page</Link></p>
    <section className={styles.formCard} style={{ marginBottom: 24 }}><h2>Enrollment phase</h2><p>Current: <strong>{phase === 'waitlist' ? 'Wanderlist first' : phase === 'public' ? 'General Founding' : 'General'}</strong>. Existing members keep the rates saved at enrollment. Canceled members rejoin at $60 + $20.</p><label htmlFor="membership-phase">Offer for new members<select id="membership-phase" value={nextPhase} disabled={busy} onChange={event => setNextPhase(event.target.value as MembershipPhase)} style={{ display: 'block', padding: 12, margin: '12px 0', maxWidth: '100%' }}><option value="waitlist">1. Wanderlist only · $50 + $10</option><option value="public">2. General Founding · $50 + $20 (Wanderlist stays $50 + $10)</option><option value="regular">3. After opening · $60 + $20</option></select></label><button className={styles.secondary} disabled={busy || nextPhase === phase} onClick={savePhase}>Save enrollment phase</button><p className={styles.small}>Changing this offer does not set a billing start date, start billing, or change existing members’ rates.</p></section>
    <div className={styles.notice}><strong>{billingEnabled ? 'Billing is enabled for explicit owner activation.' : 'Billing is disabled. Cards only; no subscriptions or charges.'}</strong><p>Review each family separately after its first membership visit. The recorded visit sets its monthly renewal day. A delayed first activation charges one full month now and keeps the original first-visit renewal day. Soft opening visits have no separate admission charge. Saving a card or checking in does not start billing automatically.</p></div>
    <div style={{ display: 'grid', gap: 16, marginTop: 24 }}>{items.map(item => <article key={item.id} className={styles.formCard}>
      <h2>{item.household?.name || 'Family'}</h2><p>{item.household?.email} · {item.household?.phone}</p><p>Status: <strong>{item.status}</strong>{item.card_last4 ? ` · Card ending ${item.card_last4}` : ''}</p><p>{MEMBERSHIP_MANAGEMENT_LABELS[item.pricing_tier]}: ${item.base_cents / 100} first child + ${item.sibling_cents / 100} per eligible sibling.</p><p>Estimate at enrollment: ${item.amount_cents / 100}/month. Sibling ages are recalculated at activation.</p>
      {item.start_date && <p>Billing start: {item.start_date}</p>}
      {['pending', 'activating'].includes(item.status) && <button className={styles.secondary} disabled={busy} onClick={() => { void openReview(item); }}>Review billing activation</button>}
    </article>)}</div>
    {selected && <section ref={reviewPanel} className={styles.formCard} style={{ marginTop: 24 }} aria-live="polite"><h2>Review monthly billing for {selected.household?.name}</h2>
      {!review && <p>{busy ? 'Checking the first visit, saved card, and existing Square subscriptions…' : 'Billing has not been started. Resolve the message below and review this family again.'}</p>}
      {review && <>
        <p><strong>${(review.amount_cents / 100).toFixed(2)}/month</strong> · {review.card_brand} ending {review.card_last4}</p>
        <p>First membership visit: <strong>{review.first_visit_date}</strong><br />First payment: <strong>${(review.amount_cents / 100).toFixed(2)} when you start billing</strong><br />Next monthly renewal: <strong>{review.next_billing_date}</strong></p>
        <p>The saved card and existing Square subscriptions were checked. Starting billing creates this family’s Square subscription and charges the saved card. If you already made a separate recurring invoice in Square, resolve it before starting here.</p>
        {!billingEnabled && <p className={styles.error}>Billing activation is not enabled for this owner account. Reviewing does not charge the card.</p>}
        <label className={styles.checkbox}><input type="checkbox" checked={firstVisitConfirmed} disabled={busy} onChange={e => setFirstVisitConfirmed(e.target.checked)} /><span>I confirm the first visit, amount, and renewal date above, and that this membership has no separate recurring invoice.</span></label>
        <label htmlFor="billing-confirm">Type START MONTHLY BILLING<input id="billing-confirm" value={confirmation} onChange={e => setConfirmation(e.target.value)} style={{ display: 'block', padding: 12, margin: '14px 0', maxWidth: '100%' }} /></label>
        <button className={styles.primary} disabled={busy || !billingEnabled || !firstVisitConfirmed || confirmation !== 'START MONTHLY BILLING'} onClick={activate}>{busy ? 'Starting…' : `Start monthly billing · $${(review.amount_cents / 100).toFixed(2)}`}</button>
      </>}
      <button className={styles.textButton} disabled={busy} onClick={() => { setSelected(null); setReview(null); }}>Go back</button>
    </section>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
  </main>;
}
