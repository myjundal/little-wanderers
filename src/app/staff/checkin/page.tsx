'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import StaffToolNav from '@/components/staff/StaffToolNav';
import { admissionGroups, squarePosCallback, type AdmissionVisit } from '@/lib/admission-pos-ui';

type DeskPerson = { id: string; first_name: string | null; last_name: string | null; role: string; birthdate: string | null };
type DeskFamily = { id: string; name: string | null; email: string | null; phone: string | null; people: DeskPerson[]; waiver_status: string;
  reservations: Array<{ id: string; child_count: number; adult_count: number; slot: { label: string; starts_at: string; ends_at: string } }> };
const personName = (person: DeskPerson) => [person.first_name, person.last_name].filter(Boolean).join(' ') || 'Unnamed visitor';
const timeLabel = (value: string) => new Date(value).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const panel: React.CSSProperties = { marginTop: 20, padding: 20, border: '1px solid #d9c8f7', borderRadius: 16, background: '#fffdf9' };
const button: React.CSSProperties = { padding: '14px 20px', borderRadius: 12, border: 0, background: '#65449b', color: '#fff', fontSize: 17, fontWeight: 700, cursor: 'pointer' };

export default function StaffCheckinPage() {
  const [visits, setVisits] = useState<AdmissionVisit[]>([]);
  const [query, setQuery] = useState('');
  const [families, setFamilies] = useState<DeskFamily[]>([]);
  const [family, setFamily] = useState<DeskFamily | null>(null);
  const [peopleIds, setPeopleIds] = useState<string[]>([]);
  const [deskLoading, setDeskLoading] = useState(true);
  const [deskError, setDeskError] = useState('');
  const [truncated, setTruncated] = useState(false);
  const [deskRefresh, setDeskRefresh] = useState(0);
  const [activeFamily, setActiveFamily] = useState('');
  const [message, setMessage] = useState('Find a family, select who is visiting, then check in and take payment.');
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [paymentsReady, setPaymentsReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [checkingIn, setCheckingIn] = useState(false);
  const [launchUrl, setLaunchUrl] = useState('');
  const [needsVerification, setNeedsVerification] = useState(false);
  const [pendingSales,setPendingSales]=useState<Array<{id:string;checkin_ids:string[]}>>([]);
  const [recoveryConfirmed,setRecoveryConfirmed]=useState(false);
  const checkinBusy = useRef(false);
  const familyRequest = useRef(0);
  const callbackBusy = useRef(false);
  const paymentPending = useRef(false);
  const groups = admissionGroups(visits);
  const selected = groups.find(group => group.id === activeFamily);
  const pendingSale=selected&&pendingSales.find(sale=>sale.checkin_ids.some(id=>selected.visits.some(visit=>visit.id===id)));

  async function refreshPayments() {
    setLoading(true);
    setPaymentsReady(false);
    try {
      const response = await fetch('/api/admin/admission/pos', { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || 'Unable to refresh admission payments.');
      setVisits(result.visits ?? []);
      setPeopleIds(previous => previous.filter(id => !(result.visits as AdmissionVisit[]).some(visit => visit.person_id === id)));
      setPendingSales(result.pending_sales??[]);
      setEnabled(result.enabled === true);
      setPaymentsReady(true);
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
      await refreshPayments();
      // Keep the callback until payment is confirmed and the paid view can be refreshed.
      const url = new URL(window.location.href);
      url.searchParams.delete('data');
      url.searchParams.delete('square_pos_return');
      window.history.replaceState({}, '', url.pathname + url.search);
      setNeedsVerification(false);
      setLaunchUrl('');
      paymentPending.current = false;
      setMessage('Payment verified — this family’s admission is paid. Choose the next family when ready.');
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
    const controller = new AbortController();
    setDeskLoading(true);
    setDeskError('');
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/admin/admission/desk?q=${encodeURIComponent(query)}`, { cache: 'no-store', signal: controller.signal });
        const result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.error || 'Unable to find families.');
        if (!controller.signal.aborted) { setFamilies(result.items); setTruncated(result.truncated); }
      } catch (error) {
        if (!controller.signal.aborted) { setFamilies([]); setDeskError(error instanceof Error ? error.message : 'Unable to load families.'); }
      } finally { if (!controller.signal.aborted) setDeskLoading(false); }
    }, query ? 250 : 0);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [query, deskRefresh]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    let id = params.get('family');
    if (!id && params.has('data')) {
      try { id = window.sessionStorage.getItem('admission-family'); } catch { /* Storage is optional. */ }
    }
    if (id) void openFamily(id);
    // Family management links open the same check-in and payment workspace.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function openFamily(id: string, preserveSelection = false) {
    const request = ++familyRequest.current;
    if (!preserveSelection) { setFamily(null); setPeopleIds([]); }
    setActiveFamily(id);
    setRecoveryConfirmed(false);
    setDeskError('');
    try {
      const response = await fetch(`/api/admin/admission/desk?family=${encodeURIComponent(id)}`, { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok || !result.ok || !result.items?.[0]) throw new Error(result.error || 'Family not found.');
      if (request !== familyRequest.current) return;
      setFamily(result.items[0]);
      setActiveFamily(result.items[0].id);
      if (preserveSelection) {
        setPeopleIds(previous => previous.filter(id => (result.items[0].people as DeskPerson[]).some(person => person.id === id)));
        setMessage(result.items[0].waiver_status === 'completed' ? 'Waiver completed. Your visitor selection is saved — you can check in now.' : 'Check-in is blocked: the family waiver still needs to be completed.');
      } else if (!new URLSearchParams(window.location.search).has('data')) setMessage(result.items[0].waiver_status === 'completed' ? 'Select only the children and adults who are here today.' : 'Check-in is blocked: a parent or legal guardian must complete the family waiver first.');
      await refreshPayments();
    } catch (error) { if (request === familyRequest.current) setDeskError(error instanceof Error ? error.message : 'Unable to open family.'); }
  }

  async function checkInFamily() {
    if (!family || !peopleIds.length || !paymentsReady || checkinBusy.current || paymentPending.current || pendingSale || loading) return;
    if (family.waiver_status !== 'completed') { setMessage('Check-in is blocked: a parent or legal guardian must complete the family waiver first.'); return; }
    checkinBusy.current = true;
    setCheckingIn(true);
    try {
      // Each person is committed with occupancy and pricing by the existing server transaction.
      // Stop on a failure; refresh reveals any successful entries and retries skip duplicates.
      for (const id of peopleIds) {
        if (visits.some(visit => visit.person_id === id)) continue;
        const response = await fetch('/api/checkin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ person_id: id, source: 'staff_manual' }) });
        const result = await response.json();
        if (result.code === 'waiver_required') setFamily(previous => previous ? { ...previous, waiver_status: 'required' } : previous);
        if ((!response.ok || !result.ok) && result.code !== 'already_checked_in') throw new Error(result.error || 'Unable to record check-in.');
      }
      setPeopleIds([]);
      setMessage('Selected visitors checked in. Review the family total below; members and prepaid visitors are applied automatically.');
    } catch (error) { setMessage(`${error instanceof Error ? error.message : 'Unable to check in.'} Any entries already recorded are shown below. Select remaining visitors to retry.`); }
    finally { await refreshPayments().catch(error => setMessage(error.message)); checkinBusy.current = false; setCheckingIn(false); }
  }

  async function takePayment() {
    if (!selected || !paymentsReady || peopleIds.length || pendingSale || busy || loading || checkingIn || needsVerification) return;
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
      if (!result.url) {await refreshPayments();throw new Error('A Square payment is already in progress. Check Square, then use the recovery section below.');}
      setPendingSales(previous=>[...previous.filter(sale=>sale.id!==result.id),{id:result.id,checkin_ids:selected.visits.map(visit=>visit.id)}]);
      setLaunchUrl(result.url);
      try { window.sessionStorage.setItem('admission-family', selected.id); } catch { /* Payment can continue without browser storage. */ }
      setMessage('Opening Square with this family’s total. If it does not open, use the Open Square link below.');
      window.location.assign(result.url);
    } catch (error) { paymentPending.current = false; setMessage(error instanceof Error ? error.message : 'Unable to open Square.'); await refreshPayments().catch(()=>{}); }
    finally { setBusy(false); }
  }


  async function recoverPayment(){
    if(!pendingSale||!recoveryConfirmed)return;
    setBusy(true);
    try{
      const response=await fetch('/api/admin/admission/pos',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({mode:'recover',state:pendingSale.id,confirm_no_payment:true})});
      const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'Unable to reconcile Square.');
      await refreshPayments();
      window.history.replaceState({},'',window.location.pathname);
      setNeedsVerification(false);setLaunchUrl('');setRecoveryConfirmed(false);paymentPending.current=false;
      setMessage(result.status==='paid'?'Square payment found and verified — admission is paid. Do not charge again.':'No active or successful payment found after your Square review. You can now prepare a fresh payment.');
    }catch(error){setMessage(error instanceof Error?error.message:'Unable to reconcile Square. Do not charge again.');}
    finally{setBusy(false);}
  }

  const locked = busy || checkingIn || !!launchUrl || needsVerification;
  const entriesLocked = locked || loading || !paymentsReady || !!pendingSale;
  const waiverBlocked = !!family && family.waiver_status !== 'completed';
  const checkinDisabled = entriesLocked || !peopleIds.length || waiverBlocked;
  const checkinBlockReason = waiverBlocked ? 'A parent or legal guardian must complete the family waiver before check-in.'
    : needsVerification ? 'Verify the previous Square payment before recording another visit.'
    : pendingSale || launchUrl ? 'Finish or reconcile this family’s Square checkout before adding visitors.'
    : loading ? 'Loading current admission status…'
    : !paymentsReady ? 'Admission status could not be loaded. Refresh payment status before checking in.'
    : !peopleIds.length ? 'Select the children and adults who are visiting.' : '';
  const familyVisits = visits.filter(visit => visit.household_id === activeFamily);
  const notCheckedIn = family?.people.filter(person => !familyVisits.some(visit => visit.person_id === person.id)) ?? [];

  return <main style={{ maxWidth: 1100, margin: '0 auto', padding: 24 }}>
    <StaffToolNav active="checkin" />
    <h1 style={{ color: '#4f3f82', marginBottom: 8 }}>Check-in &amp; payment</h1>
    <p>Find a family or choose today’s Open Play reservation. Select the people who are here, record their visit, then take one family payment in Square.</p>
    <section style={panel}>
      <label htmlFor="family-search" style={{ fontWeight: 700 }}>Search families</label>
      <input id="family-search" type="search" value={query} disabled={locked} onChange={event => setQuery(event.target.value)} placeholder="Parent or child name, email, or phone" style={{ display: 'block', boxSizing: 'border-box', width: '100%', padding: 16, marginTop: 8, border: '1px solid #d9c8f7', borderRadius: 12, fontSize: 17 }} />
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <h2>{query.trim() ? 'Search results' : 'Today’s Open Play reservations'}</h2>
        <button disabled={locked} onClick={() => { setQuery(''); setDeskRefresh(value => value + 1); void refreshPayments().catch(error => setMessage(error.message)); }}>Show / refresh today</button>
        <Link href="/staff#manual-family-registration">+ New family</Link>
      </div>
      {deskError && <p role="alert">{deskError}</p>}
      {deskLoading ? <p role="status">Loading families…</p> : <>
        {truncated && <p>Many matches found. Enter a more specific name or email to narrow the list.</p>}
        {!families.length && !deskError && <p>{query.trim() ? 'No families found. Try another name, email, or phone.' : 'No Open Play reservations today. Search by name to check in a walk-in.'}</p>}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))', gap: 12, maxHeight: 440, overflowY: 'auto' }}>
          {families.map(item => {
            const checked = visits.filter(visit => visit.household_id === item.id).length;
            return <article key={item.id} style={{ border: `2px solid ${activeFamily === item.id ? '#8a61b9' : '#eee5f8'}`, borderRadius: 12, padding: 16 }}>
              <h3 style={{ margin: 0 }}>{item.name || personName(item.people.find(person => person.role === 'adult') || item.people[0] || { id: '', first_name: 'Family', last_name: null, role: '', birthdate: null })}</h3>
              <p>{item.people.map(personName).join(', ') || 'No family members added'}</p>
              <p style={{ overflowWrap: 'anywhere' }}>{[item.email, item.phone].filter(Boolean).join(' · ')}</p>
              {item.reservations.map(reservation => <p key={reservation.id}>{timeLabel(reservation.slot.starts_at)}–{timeLabel(reservation.slot.ends_at)} · {reservation.child_count} children / {reservation.adult_count} adults</p>)}
              <p>{checked ? `${checked} checked in today` : 'Not checked in'} · {item.waiver_status === 'completed' ? 'Waiver completed' : 'Waiver needed'}</p>
              <button style={{ ...button, width: '100%' }} disabled={locked} onClick={() => void openFamily(item.id)}>Choose family</button>
            </article>;
          })}
        </div>
      </>}
    </section>
    <section style={panel} aria-live="polite"><strong>{message}</strong>
      {needsVerification && <p><button style={button} disabled={busy} onClick={() => void verifyReturn()}>Retry payment verification</button></p>}
    </section>
    {family && <section style={panel} aria-label="Visiting family members">
      <h2>{family.name || 'Selected family'}</h2>
      <p><Link href={`/staff/families/${family.id}`}>Open family details / edit people</Link> · <Link href="/waiver" target="_blank">Family waiver</Link></p>
      <p>Select everyone arriving now, including adults. Reserved headcounts are a reference; only selected people are checked in.</p>
      <button disabled={entriesLocked} onClick={() => setPeopleIds(peopleIds.length === notCheckedIn.length ? [] : notCheckedIn.map(person => person.id))}>{peopleIds.length && peopleIds.length === notCheckedIn.length ? 'Clear selection' : 'Select everyone remaining'}</button>
      <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
        {family.people.map(person => {
          const visit = familyVisits.find(visit => visit.person_id === person.id);
          return <label key={person.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 16, background: visit ? '#f0f7ef' : '#f7f3fc', borderRadius: 12 }}>
            <input type="checkbox" style={{ width: 24, height: 24 }} checked={!!visit || peopleIds.includes(person.id)} disabled={!!visit || entriesLocked} onChange={event => setPeopleIds(previous => event.target.checked ? [...previous, person.id] : previous.filter(id => id !== person.id))} />
            <span><strong>{personName(person)}</strong> · {person.role === 'child' ? 'Child' : 'Adult'}{visit && <span> · Checked in — {visit.payment_status === 'paid' ? 'Paid' : visit.price_cents === 0 ? 'Included / member / prepaid' : `${money(visit.price_cents)} due`}</span>}</span>
          </label>;
        })}
      </div>
      {!family.people.length && <p>Add family members in Family Management before check-in.</p>}
      {waiverBlocked && <aside style={{ marginTop: 16, padding: 16, border: '1px solid #d9a145', borderRadius: 12, background: '#fff3d9', color: '#69420d' }}>
        <h3 style={{ marginTop: 0 }}>Check-in blocked — family waiver needed</h3>
        <p>Ask the parent or legal guardian to open <a href="/waiver" target="_blank" rel="noreferrer">thelittlewanderers.com/waiver</a> on their own device, sign in to the account showing these children, and complete the waiver.</p>
        <p>After signing, recheck here. Your visitor selection will stay selected.</p>
        <button type="button" disabled={locked || loading} onClick={() => void openFamily(family.id, true)}>Recheck waiver</button>
      </aside>}
      {checkinBlockReason && <p id="checkin-block-reason" style={{ color: waiverBlocked ? '#8a4b0f' : '#655876', fontWeight: 600 }}>{checkinBlockReason}</p>}
      <p><button type="button" style={{ ...button, ...(checkinDisabled ? { background: '#e4dfeb', color: '#62586d', cursor: 'not-allowed' } : {}) }} disabled={checkinDisabled} aria-describedby={checkinBlockReason ? 'checkin-block-reason' : undefined} onClick={() => void checkInFamily()}>{checkingIn ? 'Recording visits…' : waiverBlocked ? 'Waiver required before check-in' : `Check in ${peopleIds.length || ''} selected visitors`}</button></p>
      <p role="status" aria-live="polite">{message}</p>
    </section>}
    <section style={panel} aria-label="Family payment">
      <h2>Family payment</h2>
      {!enabled && !loading && <p>Square handoff is currently closed. Collect admission at the counter in the Square app.</p>}
      <label>Unpaid family <select value={selected ? activeFamily : ''} disabled={locked} onChange={event => { if (event.target.value) void openFamily(event.target.value); }} style={{ padding: 12, maxWidth: '100%' }}>
        <option value="">Choose an unpaid family</option>
        {groups.map(group => <option key={group.id} value={group.id}>{group.name} — {money(group.total)}</option>)}
      </select></label>
      {selected ? <><ul>{selected.visits.map(visit => <li key={visit.id}>{visit.name} — {money(visit.price_cents)}</li>)}</ul>
        <p style={{ fontSize: 28 }}><strong>Total due: {money(selected.total)}</strong></p>
        <p>Check in everyone visiting before payment. Membership, prepaid admission, and included adults are already applied.</p>
        {!!peopleIds.length && <p>Check in the selected visitors first to include them in this payment.</p>}
        <button style={button} disabled={!enabled || entriesLocked || !!peopleIds.length} onClick={() => void takePayment()}>{busy ? 'Checking with Square…' : `Pay ${money(selected.total)} in Square`}</button>
      </> : !loading && <p>{familyVisits.length ? 'No admission payment due for this family. Paid visits, members and prepaid visitors are already accounted for.' : 'Check in a family to see their total here.'}</p>}
      {pendingSale && <aside style={{ marginTop: 20, padding: 16, background: '#fff1d8', borderRadius: 12 }}><h3>Square checkout needs review</h3><p>If Square was cancelled, did not open, or did not return a receipt, check Transactions on this iPad first. Wait at least one minute after the launch. Never reset while a payment is pending or saved offline.</p><label><input type="checkbox" checked={recoveryConfirmed} disabled={busy} onChange={event => setRecoveryConfirmed(event.target.checked)} /> I checked Square: this checkout is closed, with no completed, pending or offline payment.</label><p><button disabled={busy || !recoveryConfirmed} onClick={() => void recoverPayment()}>Reconcile Square and reset unpaid checkout</button></p><p>The server checks Square too. If it finds a completed matching payment, it records payment instead of starting another charge.</p></aside>}
      {launchUrl && <p><a href={launchUrl} style={{ fontWeight: 700 }}>Open Square{selected ? ` — ${money(selected.total)}` : ''}</a>. Use the same payment; do not start a separate sale.</p>}
      <p><button disabled={busy || checkingIn} onClick={() => void refreshPayments().catch(error => setMessage(error.message))}>Refresh payment status</button></p>
    </section>
  </main>;
}
