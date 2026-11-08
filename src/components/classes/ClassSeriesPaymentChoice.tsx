'use client';

import { useEffect, useState } from 'react';

type Child = { id: string; first_name: string; last_name: string | null };
type Availability = { payments_enabled: boolean; seats_available: number | null };
export default function ClassSeriesPaymentChoice({ familyChildren, selectedChildId, resolveChild, confirmed, authenticated }: {
  familyChildren: Child[]; selectedChildId: string; confirmed: boolean; authenticated: boolean;
  resolveChild: () => Promise<{ id: string; guardian_first_name: string; guardian_last_name: string }>;
}) {
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [siblings, setSiblings] = useState<string[]>([]);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [checkout, setCheckout] = useState<{ id: string; url: string; amount: number } | null>(null);
  const [paid, setPaid] = useState(false);
  useEffect(() => {
    let active = true;
    const load = () => fetch('/api/classes/series', { cache: 'no-store' }).then(res => res.json()).then(data => { if (active) setAvailability(data); }).catch(() => {});
    void load();
    const timer = window.setInterval(load, 30_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);
  useEffect(() => {
    if (!checkout) return;
    const verify = async () => {
      try {
        const res = await fetch(`/api/classes/series-checkout?id=${encodeURIComponent(checkout.id)}`, { cache: 'no-store' });
        const data = await res.json();
        if (data.status === 'paid') { setPaid(true); setCheckout(null); }
        if (data.status === 'review') setError('Payment received and awaiting staff review. Please contact us before paying again.');
      } catch {}
    };
    const timer = window.setInterval(verify, 8_000);
    window.addEventListener('focus', verify);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', verify); };
  }, [checkout]);
  const start = async () => {
    if (busy) return;
    if (!authenticated) { window.location.assign('/login?mode=new&next=%2Flanding%2Fclassschedule'); return; }
    setBusy(true); setError('');
    try {
      const child = await resolveChild();
      const childIds = [...new Set([child.id, ...siblings.filter(id => id !== child.id)])];
      const res = await fetch('/api/classes/series-checkout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ child_ids: childIds, accept_terms: accepted, guardian_first_name: child.guardian_first_name, guardian_last_name: child.guardian_last_name }) });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Unable to open checkout.');
      if (data.status === 'paid') { setPaid(true); return; }
      if (!data.payment_url) throw new Error('The payment page is not ready. Please refresh and try again.');
      setCheckout({ id: data.sale_id, url: data.payment_url, amount: data.amount_cents });
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to open checkout.'); }
    finally { setBusy(false); }
  };
  if (confirmed || paid) return <p role="status" style={{ color: '#2f7a47', fontWeight: 800 }}>Payment confirmed — your seat is reserved for all five sessions.</p>;
  return <div style={{ marginTop: 12, padding: 14, borderRadius: 14, background: '#f3ebff', color: '#4f3f82', lineHeight: 1.6 }}>
    <strong>Limited seats. Only completed payment confirms your place.</strong>
    <p style={{ margin: '6px 0' }}>Full 5-session series: first child $150; second child $130. Dates: Nov 12, Nov 19, Dec 3, Dec 10, Dec 17, 5:00–5:45 PM Eastern. No class on Thanksgiving.</p>
    <p style={{ margin: '6px 0' }}><strong>{availability?.seats_available == null ? 'Checking seats…' : `${availability.seats_available} seat${availability.seats_available === 1 ? '' : 's'} currently available`}</strong>. Interest does not reserve a seat.</p>
    {familyChildren.some(child => child.id !== selectedChildId) && <fieldset style={{ border: '1px solid #d9c8f7', borderRadius: 10, margin: '10px 0' }}><legend>Include a sibling / twin</legend>{familyChildren.filter(child => child.id !== selectedChildId).map(child => <label key={child.id} style={{ display: 'block' }}><input type="checkbox" checked={siblings.includes(child.id)} onChange={event => setSiblings(current => event.target.checked ? [...current, child.id] : current.filter(id => id !== child.id))} /> {child.first_name} {child.last_name}</label>)}</fieldset>}
    <p style={{ margin: '8px 0' }}>Payment due <strong>Nov 11 at 5:00 PM Eastern</strong>, 24 hours before the first class. This series is <strong>nonrefundable unless canceled by the instructor</strong>.</p>
    <label style={{ display: 'block', margin: '10px 0' }}><input type="checkbox" checked={accepted} onChange={event => setAccepted(event.target.checked)} /> I agree to the series dates, payment deadline, and cancellation policy.</label>
    {checkout ? <div><strong>Series total: ${(checkout.amount / 100).toFixed(2)}</strong><p><a href={checkout.url} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-block', padding: '12px 16px', borderRadius: 12, background: '#65449b', color: '#fff', fontWeight: 800 }}>Continue to secure payment ↗</a></p><p>Your seat is not confirmed until payment is completed. Return here to check your confirmation.</p></div>
      : <button type="button" onClick={() => void start()} disabled={busy || !accepted || !availability?.payments_enabled || availability.seats_available === 0} style={{ padding: '12px 16px', borderRadius: 12, border: 0, background: '#65449b', color: '#fff', fontWeight: 800, opacity: busy || !accepted || !availability?.payments_enabled || availability.seats_available === 0 ? .55 : 1 }}>{busy ? 'Preparing secure payment…' : 'Pay now to reserve seat'}</button>}
    {availability && !availability.payments_enabled && <p>Paid registration is not open right now. You can still express interest for free. No payment is collected, and no seat is reserved.</p>}
    {error && <p role="alert" style={{ color: '#8a3f6b' }}>{error}</p>}
  </div>;
}
