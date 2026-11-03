'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import styles from '@/components/membership/founding.module.css';

type Item = { id: string; status: string; amount_cents: number; start_date: string | null; card_last4: string | null; household: { name: string; email: string; phone: string } };

export default function FoundingMembershipsPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [billingEnabled, setBillingEnabled] = useState(false);
  const [startDate, setStartDate] = useState('');
  const [selected, setSelected] = useState<Item | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const response = await fetch('/api/admin/founding-memberships', { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    setItems(data.items); setBillingEnabled(data.billing_enabled);
  }, []);
  useEffect(() => { void load().catch(err => setError(err.message)); }, [load]);

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
    <div className={styles.notice}><strong>{billingEnabled ? 'Billing is enabled for explicit owner activation.' : 'Billing is disabled. Cards only; no subscriptions or charges.'}</strong><p>The opening date has no default. On the actual opening day, enter its date and activate each reserved family explicitly. There is no scheduled billing job.</p></div>
    <label htmlFor="opening-date">Confirmed opening date<input id="opening-date" type="date" value={startDate} disabled={!billingEnabled || busy} onChange={e => setStartDate(e.target.value)} style={{ display: 'block', margin: '12px 0', padding: 12 }} /></label>
    <div style={{ display: 'grid', gap: 16, marginTop: 24 }}>{items.map(item => <article key={item.id} className={styles.formCard}>
      <h2>{item.household?.name || 'Family'}</h2><p>{item.household?.email} · {item.household?.phone}</p><p>Status: <strong>{item.status}</strong>{item.card_last4 ? ` · Card ending ${item.card_last4}` : ''}</p><p>Estimate at enrollment: ${item.amount_cents / 100}/month. Sibling ages are recalculated at activation.</p>
      {item.start_date && <p>Billing start: {item.start_date}</p>}
      {['pending', 'activating'].includes(item.status) && <button className={styles.secondary} disabled={!billingEnabled || !startDate || busy} onClick={() => { setSelected(item); setConfirmation(''); }}>Review billing activation</button>}
    </article>)}</div>
    {selected && <section className={styles.formCard} style={{ marginTop: 24 }}><h2>Start monthly billing for {selected.household?.name}</h2><p>This creates a Square subscription and can charge the saved card today. First-child rate: $50/month; each eligible sibling: $20/month.</p><p>Explicit start date: <strong>{startDate}</strong></p><label htmlFor="billing-confirm">Type START MONTHLY BILLING<input id="billing-confirm" value={confirmation} onChange={e => setConfirmation(e.target.value)} style={{ display: 'block', padding: 12, margin: '14px 0', maxWidth: '100%' }} /></label><button className={styles.primary} disabled={busy || confirmation !== 'START MONTHLY BILLING'} onClick={activate}>{busy ? 'Starting…' : 'Start this family’s monthly billing'}</button><button className={styles.textButton} disabled={busy} onClick={() => setSelected(null)}>Go back</button></section>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
  </main>;
}
