'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Html5QrcodeScanner } from 'html5-qrcode';
import { admissionGroups, squarePosCallback, type AdmissionVisit } from '@/lib/admission-pos-ui';

type ScanResult = { checkin_id: string; first_name?: string; last_name?: string; price_cents: number; payment_status?: string; membership_applied?: boolean };
const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const panel: React.CSSProperties = { marginTop: 20, padding: 20, border: '1px solid #d9c8f7', borderRadius: 16, background: '#fffdf9' };
const button: React.CSSProperties = { padding: '14px 20px', borderRadius: 12, border: 0, background: '#65449b', color: '#fff', fontSize: 17, fontWeight: 700, cursor: 'pointer' };

export default function StaffCheckinPage() {
  const [visits, setVisits] = useState<AdmissionVisit[]>([]);
  const [scans, setScans] = useState<ScanResult[]>([]);
  const [activeFamily, setActiveFamily] = useState('');
  const [message, setMessage] = useState('Scan every visiting family member before taking payment.');
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [launchUrl, setLaunchUrl] = useState('');
  const [needsVerification, setNeedsVerification] = useState(false);
  const started = useRef(false);
  const scanInFlight = useRef(false);
  const lastScan = useRef({ id: '', time: 0 });
  const callbackBusy = useRef(false);
  const paymentPending = useRef(false);
  const groups = admissionGroups(visits);
  const selected = groups.find(group => group.id === activeFamily);

  async function refreshPayments(personId?: string) {
    setLoading(true);
    try {
      const response = await fetch('/api/admin/admission/pos', { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || 'Unable to refresh admission payments.');
      setVisits(result.visits ?? []);
      setEnabled(result.enabled === true);
      if (personId) {
        const visit = (result.visits as AdmissionVisit[]).find(visit => visit.person_id === personId);
        setActiveFamily(visit?.household_id ?? '');
      }
    } finally { setLoading(false); }
  }

  async function verifyReturn() {
    const callback = squarePosCallback(window.location.search);
    if (!callback || callbackBusy.current) return;
    if (callback.status !== 'ok') {
      setNeedsVerification(false);
      setMessage('Square payment was cancelled or interrupted. Check Square’s transactions before taking another payment.');
      return;
    }
    callbackBusy.current = true;
    paymentPending.current = true;
    setBusy(true);
    setNeedsVerification(true);
    try {
      const response = await fetch('/api/admin/admission/pos', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'verify', state: callback.state, transaction_id: callback.transaction_id }) });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || 'Payment verification is pending.');
      // Keep the callback in the URL until both Square and the database confirm payment.
      const url = new URL(window.location.href);
      url.searchParams.delete('data');
      url.searchParams.delete('square_pos_return');
      window.history.replaceState({}, '', url.pathname + url.search);
      setNeedsVerification(false);
      setLaunchUrl('');
      paymentPending.current = false;
      setMessage('Payment verified — this family’s admission is paid. Scan the next family when ready.');
      await refreshPayments();
    } catch (error) {
      setMessage(`${error instanceof Error ? error.message : 'Unable to verify payment.'} Do not charge again. Retry verification or refresh this page.`);
    } finally { callbackBusy.current = false; setBusy(false); }
  }

  useEffect(() => {
    void refreshPayments().catch(error => setMessage(error.message));
    void verifyReturn();
    // Initial load and Square return are handled once; callbacks are idempotent on the server.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const scanner = new Html5QrcodeScanner('qr-reader', { fps: 10, qrbox: 250 }, false);
    scanner.render(async text => {
      if (scanInFlight.current || paymentPending.current) return;
      const id = text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i)?.[0];
      if (!id) { setMessage('This is not a Little Wanderers person QR code.'); return; }
      if (lastScan.current.id === id && Date.now() - lastScan.current.time < 8000) return;
      lastScan.current = { id, time: Date.now() };
      scanInFlight.current = true;
      setScanning(true);
      setLaunchUrl('');
      try {
        setMessage('Checking waiver, membership and admission…');
        const response = await fetch('/api/checkin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ person_id: id, source: 'qr' }) });
        const result = await response.json();
        if (!response.ok || !result.ok) {
          if (result.code === 'already_checked_in') await refreshPayments(id);
          throw new Error(result.error || 'Unable to check in.');
        }
        setScans(previous => [...previous.filter(scan => scan.checkin_id !== result.checkin_id), result]);
        await refreshPayments(id);
        setMessage(result.price_cents > 0 ? 'Check-in recorded. Scan the rest of this family, then take their payment below.'
          : result.payment_status === 'paid' ? 'Check-in recorded — prepaid admission verified.' : 'Check-in recorded — no additional charge for this person.');
      } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to check in.'); }
      finally { scanInFlight.current = false; setScanning(false); }
    }, () => {});
    return () => { void scanner.clear().catch(() => {}); started.current = false; };
    // Scanner callbacks use server refreshes and functional state updates.
  }, []);

  async function takePayment() {
    if (!selected || busy || loading || scanning || needsVerification) return;
    if (!/iPad|iPhone|iPod/.test(navigator.userAgent) && !(navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) {
      setMessage('Open this staff page in Safari on the Square iPad to take a card payment.');
      return;
    }
    setBusy(true);
    paymentPending.current = true;
    try {
      const response = await fetch('/api/admin/admission/pos', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ checkin_ids: selected.visits.map(visit => visit.id) }) });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || 'Unable to open Square.');
      if (!result.url) throw new Error('A Square payment is already in progress. Check the existing transaction before charging again.');
      setLaunchUrl(result.url);
      setMessage('Opening Square with this family’s total. If it does not open, use the Open Square link below.');
      window.location.assign(result.url);
    } catch (error) { paymentPending.current = false; setMessage(error instanceof Error ? error.message : 'Unable to open Square.'); }
    finally { setBusy(false); }
  }

  return <main style={{ maxWidth: 900, margin: '0 auto', padding: 24 }}>
    <header style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
      <h1>Staff Check-in</h1><nav style={{ display: 'flex', gap: 16, alignItems: 'center' }}><Link href="/landing">Dashboard</Link><Link href="/staff">Operator tools</Link></nav>
    </header>
    <p>Scan this visiting family’s QR codes, review their total, then take one payment in Square.</p>
    <div id="qr-reader" style={{ width: 360, maxWidth: '100%' }} />
    <section style={panel} aria-live="polite"><strong>{message}</strong>
      {needsVerification && <p><button style={button} disabled={busy} onClick={() => void verifyReturn()}>Retry payment verification</button></p>}
    </section>
    <section style={panel} aria-label="Family payment">
      <h2>Family admission</h2>
      {!enabled && !loading && <p>Square handoff is currently closed. Collect admission at the counter in the Square app.</p>}
      <label>Visiting family <select value={activeFamily} disabled={busy || scanning || !!launchUrl || needsVerification} onChange={event => setActiveFamily(event.target.value)} style={{ padding: 10, maxWidth: '100%' }}>
        <option value="">Scan a family QR or choose a family</option>
        {groups.map(group => <option key={group.id} value={group.id}>{group.name} — {money(group.total)}</option>)}
      </select></label>
      {selected ? <><ul>{selected.visits.map(visit => <li key={visit.id}>{visit.name} — {money(visit.price_cents)}</li>)}</ul>
        <p style={{ fontSize: 24 }}><strong>Total due: {money(selected.total)}</strong></p>
        <p>Finish scanning everyone in this family before taking payment. Membership and included-adult rates are already applied.</p>
        <button style={button} disabled={!enabled || busy || scanning || loading || !!launchUrl || needsVerification} onClick={() => void takePayment()}>{busy ? 'Checking with Square…' : `Pay ${money(selected.total)} in Square`}</button>
      </> : !loading && <p>No unpaid admission selected. Members and prepaid visitors do not need another admission payment.</p>}
      {launchUrl && <p><a href={launchUrl} style={{ fontWeight: 700 }}>Open Square{selected ? ` — ${money(selected.total)}` : ''}</a>. Use the same payment; do not start a separate sale.</p>}
      <p><button disabled={busy || scanning} onClick={() => void refreshPayments().catch(error => setMessage(error.message))}>Refresh payment status</button></p>
    </section>
    {scans.length > 0 && <section style={panel}><h2>Scanned this session</h2><ul>{scans.map(scan => <li key={scan.checkin_id}>{scan.first_name} {scan.last_name} — {scan.membership_applied ? 'Membership' : scan.price_cents === 0 ? 'Included / prepaid' : money(scan.price_cents)}</li>)}</ul><p>Session amounts show the original check-in quote. Current unpaid totals are shown above.</p></section>}
  </main>;
}
