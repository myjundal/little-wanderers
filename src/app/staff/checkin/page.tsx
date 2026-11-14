'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import StaffToolNav from '@/components/staff/StaffToolNav';
import StaffDashboard from '@/components/staff/StaffDashboard';
import { arrivalGroups, familyArrival, type ArrivalCard, type DeskPerson, type DeskFamily } from '@/lib/admission-arrivals';
import { admissionDate, admissionTime, stayLabel, stayMinutes } from '@/lib/admission-stays';
import { admissionPaymentLabel, reservationAdmissionLabel } from '@/lib/admission-payment-status';
import AdmissionStayStatistics from '@/components/staff/AdmissionStayStatistics';
import AdmissionHelp from '@/components/staff/AdmissionHelp';
import { admissionGroups, squarePosCallback, readPendingAdmissionPos, PENDING_ADMISSION_POS_KEY, type AdmissionVisit, type PendingAdmissionPos } from '@/lib/admission-pos-ui';
import styles from './checkin.module.css';

const personName = (person: DeskPerson) => [person.first_name, person.last_name].filter(Boolean).join(' ') || 'Unnamed visitor';
const timeLabel = (value: string) => new Date(value).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
const dateLabel = (value: string) => new Date(value).toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const panel: React.CSSProperties = { marginTop: 20, padding: 20, border: '1px solid #d9c8f7', borderRadius: 16, background: '#fffdf9' };
const button: React.CSSProperties = { padding: '14px 20px', borderRadius: 12, border: 0, background: '#65449b', color: '#fff', fontSize: 17, fontWeight: 700, cursor: 'pointer' };

export default function StaffCheckinPage() {
  const [completion, setCompletion] = useState<{ familyName: string; visitors: string[] } | null>(null);
  const completionDialog = useRef<HTMLDialogElement | null>(null);
  const arrivalBoard = useRef<HTMLDivElement | null>(null);
  const visitingFamily = useRef<HTMLElement | null>(null);
  const [visits, setVisits] = useState<AdmissionVisit[]>([]);
  const [query, setQuery] = useState('');
  const [deskDate, setDeskDate] = useState(admissionDate(new Date().toISOString()));
  const [datedVisits, setDatedVisits] = useState<AdmissionVisit[]>([]);
  const isToday = deskDate === admissionDate(new Date().toISOString());
  const boardVisits = isToday ? visits : datedVisits;
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
  const [checkingOut, setCheckingOut] = useState('');
  const [squareCustomerMessage, setSquareCustomerMessage] = useState('');
  const [connectingCustomer, setConnectingCustomer] = useState(false);
  const [staffMode, setStaffMode] = useState<'home-screen' | 'browser' | null>(null);
  const checkoutBusy = useRef(false);
  const [launchUrl, setLaunchUrl] = useState('');
  const [needsVerification, setNeedsVerification] = useState(false);
  const [pendingSales,setPendingSales]=useState<Array<{id:string;checkin_ids:string[]}>>([]);
  const [recoveryConfirmed,setRecoveryConfirmed]=useState(false);
  const checkinBusy = useRef(false);
  const familyRequest = useRef(0);
  const callbackBusy = useRef(false);
  const paymentPending = useRef(false);
  const pendingLaunch = useRef<PendingAdmissionPos | null>(null);
  const resumeBusy = useRef(false);
  const paymentRequest = useRef(0);
  const [pendingPosId, setPendingPosId] = useState('');
  const groups = admissionGroups(visits);
  const selected = groups.find(group => group.id === activeFamily);
  const pendingSale=pendingSales.find(sale=>sale.checkin_ids.some(id=>visits.some(visit=>visit.id===id && visit.household_id===activeFamily)));
  const paymentUnverified = visits.some(visit=>visit.household_id===activeFamily && ['pending','review'].includes(visit.payment_status));

  useEffect(() => {
    if (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) {
      setStaffMode((navigator as Navigator & { standalone?: boolean }).standalone || window.matchMedia?.('(display-mode: standalone)').matches ? 'home-screen' : 'browser');
    }
  }, []);

  async function refreshPayments() {
    const request = ++paymentRequest.current;
    setLoading(true);
    setPaymentsReady(false);
    try {
      const response = await fetch('/api/admin/admission/pos', { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || 'Unable to refresh admission payments.');
      const currentVisits = (result.visits ?? []) as AdmissionVisit[];
      if (request !== paymentRequest.current) return currentVisits;
      setVisits(currentVisits);
      if (result.settled_count > 0) setDeskRefresh(value=>value+1);
      setPeopleIds(previous => previous.filter(id => !currentVisits.some(visit => visit.person_id === id)));
      setPendingSales(result.pending_sales??[]);
      setEnabled(result.enabled === true);
      setPaymentsReady(true);
      // A Home Screen app may be restored without the Safari callback or its tab
      // storage. Recover only this operator's already-launched, current-day sale.
      if (!pendingLaunch.current) {
        const launch = (result.pending_sales ?? []).filter((sale: { launched_at?: string; checkin_ids: string[] }) => sale.launched_at
          && Date.now() - Date.parse(sale.launched_at) < 86400000
          && sale.checkin_ids.some(id => currentVisits.some(visit => visit.id === id)))
          .sort((a: { launched_at: string }, b: { launched_at: string }) => b.launched_at.localeCompare(a.launched_at))[0];
        const visitor = launch && currentVisits.find(visit => launch.checkin_ids.includes(visit.id));
        if (launch && visitor?.household_id) {
          pendingLaunch.current = { id: launch.id, family_id: visitor.household_id, started_at: Date.parse(launch.launched_at) };
          setPendingPosId(launch.id);
        }
      }
      return currentVisits;
    } finally { if (request === paymentRequest.current) setLoading(false); }
  }

  function clearPendingPos(id: string) {
    pendingLaunch.current = null;
    paymentPending.current = false;
    setPendingPosId('');
    setLaunchUrl('');
    setNeedsVerification(false);
    setRecoveryConfirmed(false);
    setPendingSales(previous => previous.filter(sale => sale.id !== id));
    try { window.sessionStorage.removeItem(PENDING_ADMISSION_POS_KEY); } catch { /* Server state is authoritative. */ }
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
      setDeskRefresh(value => value + 1);
      // Keep the callback until payment is confirmed and the paid view can be refreshed.
      const url = new URL(window.location.href);
      url.searchParams.delete('data');
      url.searchParams.delete('square_pos_return');
      window.history.replaceState({}, '', url.pathname + url.search);
      clearPendingPos(callback.state);
      setMessage('Payment verified — this family’s admission is paid. Choose the next family when ready.');
    } catch (error) {
      setMessage(`${error instanceof Error ? error.message : 'Unable to verify payment.'} Do not charge again. Retry verification or refresh this page.`);
    } finally { callbackBusy.current = false; setBusy(false); }
  }

  async function resumePayments() {
    if (resumeBusy.current || checkinBusy.current || checkoutBusy.current) return;
    resumeBusy.current = true;
    try {
      const callback = squarePosCallback(window.location.search);
      if (callback?.status === 'ok') { await verifyReturn(); return; }
      await refreshPayments();
      const launch = pendingLaunch.current;
      if (!launch) return;
      const response = await fetch('/api/admin/admission/pos', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'sync', state: launch.id }) });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || 'Square payment verification is pending.');
      if (result.status === 'paid' || result.status === 'cancelled') {
        clearPendingPos(launch.id);
        setCompletion(null);
        await refreshPayments();
        setDeskRefresh(value => value + 1);
        setMessage(result.status === 'paid' ? 'Payment verified — this family’s admission is paid. Choose the next family when ready.' : 'Square checkout was closed after review. Admission status is refreshed.');
      }
    } catch (error) {
      setMessage(`${error instanceof Error ? error.message : 'Unable to refresh Square payment.'} Do not charge again. Refresh payment status to retry.`);
    } finally { resumeBusy.current = false; }
  }

  useEffect(() => {
    try {
      const launch = readPendingAdmissionPos(window.sessionStorage.getItem(PENDING_ADMISSION_POS_KEY));
      if (launch) { pendingLaunch.current = launch; setPendingPosId(launch.id); }
    } catch { /* The server also restores this operator's current pending sale. */ }
    void resumePayments();
    // Initial load and Square return are handled once; callbacks are idempotent on the server.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const resume = () => {
      setDeskRefresh(value => value + 1);
      void resumePayments();
    };
    const visible = () => { if (document.visibilityState === 'visible') resume(); };
    window.addEventListener('pageshow', resume);
    window.addEventListener('focus', resume);
    document.addEventListener('visibilitychange', visible);
    return () => { window.removeEventListener('pageshow', resume); window.removeEventListener('focus', resume); document.removeEventListener('visibilitychange', visible); };
    // Refresh saved visits and counts when returning from the Square app.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      void resumePayments();
      setDeskRefresh(value => value + 1);
    }, 60000);
    return () => window.clearInterval(timer);
    // Keep other operators' arrivals and departures current on the shared desk.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!pendingPosId) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void resumePayments();
    }, 5000);
    return () => window.clearInterval(timer);
    // Retry a newly completed receipt while Square finishes publishing it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingPosId]);

  useEffect(() => {
    const controller = new AbortController();
    setDeskLoading(true);
    setDeskError('');
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/admin/admission/desk?q=${encodeURIComponent(query)}&date=${deskDate}`, { cache: 'no-store', signal: controller.signal });
        const result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.error || 'Unable to find families.');
        let history: AdmissionVisit[] = [];
        if (!isToday) {
          const response = await fetch(`/api/admin/admission/pos?date=${deskDate}`, { cache: 'no-store', signal: controller.signal });
          const payments = await response.json();
          if (!response.ok || !payments.ok) throw new Error(payments.error || 'Unable to load check-in history.');
          history = payments.visits ?? [];
        }
        if (!controller.signal.aborted) { setFamilies(result.items); setDatedVisits(history); setTruncated(result.truncated); }
      } catch (error) {
        if (!controller.signal.aborted) { setFamilies([]); setDeskError(error instanceof Error ? error.message : 'Unable to load families.'); }
      } finally { if (!controller.signal.aborted) setDeskLoading(false); }
    }, query ? 250 : 0);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [query, deskRefresh, deskDate, isToday]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedView = params.get('view');
    if (requestedView === 'reservations' && !params.has('data')) { window.location.replace('/staff/open-play-reservations'); return; }
    let id = params.get('family');
    if (!id && params.has('data')) {
      try { id = window.sessionStorage.getItem('admission-family'); } catch { /* Storage is optional. */ }
    }
    if (id) void openFamily(id);
    // Family management links open the same check-in and payment workspace.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const viewingFamilyId = family?.id;
  useEffect(() => {
    if (viewingFamilyId) visitingFamily.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [viewingFamilyId]);

  useEffect(() => {
    const dialog = completionDialog.current;
    if (completion && dialog && !dialog.open) dialog.showModal();
  }, [completion]);

  function returnToDesk() {
    setCompletion(null);
    arrivalBoard.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    arrivalBoard.current?.querySelectorAll<HTMLElement>('[data-arrival-scroll]').forEach(row => row.scrollTo({ left: 0 }));
  }

  async function openFamily(id: string, preserveSelection = false) {
    const request = ++familyRequest.current;
    if (!preserveSelection) { setFamily(null); setPeopleIds([]); }
    setActiveFamily(id);
    setSquareCustomerMessage('');
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

  async function connectSquareCustomer() {
    if (!family || connectingCustomer || locked) return;
    setConnectingCustomer(true);
    const id = family.id;
    const request = familyRequest.current;
    try {
      const response = await fetch('/api/admin/families/square', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ household_id: id }) });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || 'Unable to connect Square customer.');
      if (request !== familyRequest.current) return;
      setSquareCustomerMessage(`${result.created ? 'Created' : 'Connected'} Square customer: ${result.name || family.name}. In Square, choose Add customer and search ${result.email || result.phone || result.name}. Attach snack and drink purchases to this customer. New profiles may take a minute to appear.`);
    } catch (error) { if (request === familyRequest.current) setSquareCustomerMessage(error instanceof Error ? error.message : 'Unable to connect Square customer.'); }
    finally { setConnectingCustomer(false); }
  }

  async function checkInFamily() {
    if (!isToday || !family || !peopleIds.length || !paymentsReady || checkinBusy.current || paymentPending.current || pendingSale || loading) return;
    if (family.waiver_status !== 'completed') { setMessage('Check-in is blocked: a parent or legal guardian must complete the family waiver first.'); return; }
    checkinBusy.current = true;
    setCheckingIn(true);
    let refreshed = false;
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
      const currentVisits = await refreshPayments();
      refreshed = true;
      if (!peopleIds.every(id => currentVisits.some(visit => visit.person_id === id))) throw new Error('Unable to confirm every selected visitor. Refresh admission status before continuing.');
      setCompletion({ familyName: family.name || 'Selected family', visitors: family.people.filter(person => peopleIds.includes(person.id)).map(personName) });
      setQuery('');
      setDeskRefresh(value => value + 1);
      setMessage('Check-in complete. Review the family total and continue to Square for payment.');
    } catch (error) { setMessage(`${error instanceof Error ? error.message : 'Unable to check in.'} Any entries already recorded are shown below. Select remaining visitors to retry.`); }
    finally { if (!refreshed) { await refreshPayments().catch(error => setMessage(error.message)); setDeskRefresh(value => value + 1); } checkinBusy.current = false; setCheckingIn(false); }
  }

  async function takePayment() {
    if (!isToday || !selected || !enabled || !paymentsReady || peopleIds.length || paymentPending.current || pendingSale || busy || loading || checkingIn || needsVerification) return;
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
      pendingLaunch.current = { id: result.id, family_id: selected.id, started_at: Date.now() };
      setPendingPosId(result.id);
      setLaunchUrl(result.url);
      setCompletion(null);
      try { window.sessionStorage.setItem('admission-family', selected.id); window.sessionStorage.setItem(PENDING_ADMISSION_POS_KEY, JSON.stringify(pendingLaunch.current)); } catch { /* Payment can continue without browser storage. */ }
      setMessage('Opening Square with this family’s total. If it does not open, use the Open Square link below.');
      window.location.assign(result.url);
    } catch (error) { paymentPending.current = false; setMessage(error instanceof Error ? error.message : 'Unable to open Square.'); await refreshPayments().catch(()=>{}); }
    finally { setBusy(false); }
  }

  async function checkOutFamily(householdId: string, ids: string[]) {
    if (locked || !paymentsReady || loading || checkoutBusy.current || paymentPending.current) return;
    checkoutBusy.current = true;
    setCheckingOut(householdId);
    let recorded = false;
    try {
      const response = await fetch('/api/admin/admission/checkout', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ household_id: householdId, checkin_ids: ids }) });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || 'Unable to check out family.');
      recorded = true;
      const departures = new Map<string, string>((result.checkouts ?? []).map((row: { id: string; checked_out_at: string }) => [row.id, row.checked_out_at]));
      setVisits(previous => previous.map(visit => departures.has(visit.id) ? { ...visit, checked_out_at: departures.get(visit.id) } : visit));
      setDeskRefresh(value => value + 1);
      await refreshPayments();
      setMessage('Family checked out. Departure times and crowd count are saved.');
    } catch (error) {
      setMessage(`${recorded ? 'Checkout is saved. ' : ''}${error instanceof Error ? error.message : 'Unable to check out family.'}`);
    } finally { checkoutBusy.current = false; setCheckingOut(''); }
  }


  async function recoverPayment(){
    if(!pendingSale||!recoveryConfirmed)return;
    setBusy(true);
    try{
      const response=await fetch('/api/admin/admission/pos',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({mode:'recover',state:pendingSale.id,confirm_no_payment:true})});
      const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'Unable to reconcile Square.');
      await refreshPayments();
      setDeskRefresh(value => value + 1);
      window.history.replaceState({},'',window.location.pathname);
      setNeedsVerification(false);setLaunchUrl('');setRecoveryConfirmed(false);paymentPending.current=false;
      if (pendingLaunch.current) clearPendingPos(pendingLaunch.current.id);
      setMessage(result.status==='paid'?'Square payment found and verified — admission is paid. Do not charge again.':'No active or successful payment found after your Square review. You can now prepare a fresh payment.');
    }catch(error){setMessage(error instanceof Error?error.message:'Unable to reconcile Square. Do not charge again.');}
    finally{setBusy(false);}
  }

  const locked = busy || checkingIn || !!checkingOut || !!launchUrl || needsVerification || !!completion;
  const entriesLocked = !isToday || locked || loading || !paymentsReady || !!pendingSale;
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

  function selectDeskDate(date: string) {
    familyRequest.current++; setDeskDate(date); setQuery(''); setFamily(null); setActiveFamily(''); setPeopleIds([]); setFamilies([]); setDatedVisits([]); setDeskLoading(true);
  }
  function shiftDeskDate(days: number) {
    selectDeskDate(new Date(Date.parse(`${deskDate}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10));
  }

  const board = arrivalGroups(families, boardVisits, deskDate);
  function renderFamilyCard(card: ArrivalCard, horizontal = false) {
    const item = card.family;
    const todayVisits = boardVisits.filter(visit => visit.household_id === item.id);
    const present = todayVisits.filter(visit => !visit.checked_out_at);
    const departed = todayVisits.length > 0 && !present.length;
    const booked = card.reservation ?? item.reservations.find(reservation=>admissionDate(reservation.slot.starts_at)===deskDate)
      ?? item.reservations.find(reservation=>Date.parse(reservation.slot.ends_at)>Date.now()) ?? item.reservations.at(-1);
    const review = todayVisits.some(visit => visit.payment_status === 'review');
    const pending = todayVisits.some(visit => visit.payment_status === 'pending');
    const due = todayVisits.filter(visit => visit.payment_status === 'due').reduce((total, visit) => total + visit.price_cents, 0);
    const settled = todayVisits.length > 0 && todayVisits.every(visit => ['paid','prepaid','walkin_paid','terminal_paid','covered','included','membership'].includes(visit.payment_status));
    const reservationPaid = booked && ['paid_online','paid_counter','paid_or_included'].includes(booked.admission_status ?? '');
    const payment = review ? 'Check Square receipt' : pending ? 'Checking payment' : due > 0 ? `${money(due)} due`
      : reservationPaid || (settled && todayVisits.some(visit=>['paid','prepaid','walkin_paid','terminal_paid'].includes(visit.payment_status))) ? 'Paid'
      : booked?.admission_status === 'included' || (settled && !booked) ? 'Included'
      : booked?.admission_status === 'review' ? 'Check payment' : booked?.admission_status === 'pending' ? 'Checking payment'
      : booked?.admission_status === 'due' ? 'Pay at desk' : '';
    const children = item.people.filter(person => person.role === 'child' && (!card.reservation?.child_ids?.length || card.reservation.child_ids.includes(person.id))).map(personName).join(', ');
    return <article key={card.reservation?.id ?? item.id} data-family-id={item.id} data-arrival-state={departed ? 'checked-out' : card.completed ? 'checked-in' : card.checkedChildren ? 'partial' : 'waiting'} className={`${styles.familyRow} ${horizontal ? styles.familyCard : ''} ${departed ? styles.checkedOut : card.completed ? styles.checkedIn : styles.waiting} ${activeFamily === item.id ? styles.selectedFamily : ''}`}>
      <div className={horizontal ? styles.cardArrivalTime : styles.arrivalTime}>{booked ? <><strong>{timeLabel(booked.slot.starts_at)}</strong>{query.trim() && <span>{new Date(booked.slot.starts_at).toLocaleDateString('en-US', {timeZone:'America/New_York',month:'short',day:'numeric'})}</span>}</> : <span>Walk-in</span>}</div>
      <div className={styles.familySummary}>
        <h3>{item.name || personName(item.people.find(person => person.role === 'adult') || item.people[0] || { id: '', first_name: 'Family', last_name: null, role: '', birthdate: null })}</h3>
        {children && <p className={styles.childNames}>{children}</p>}
        <div className={styles.familyStatus}><span>{present.length ? isToday ? `Checked in · ${present.length} guests here` : 'Checked in on this date' : departed ? 'Checked out' : 'Not checked in'}</span>
          {card.reservation && !card.completed && card.checkedChildren > 0 && <span>{card.checkedChildren}/{card.expectedChildren} children checked in</span>}{payment && <span>{payment}</span>}{item.waiver_status !== 'completed' && <span className={styles.waiverNeeded}>Waiver needed</span>}
        </div>
      </div>
      <div className={styles.familyActions}>
        {present.length > 0 && <button className={styles.rowCheckout} aria-label={`Check out family (${present.length})`} disabled={!isToday || locked || loading || !paymentsReady} onClick={() => void checkOutFamily(item.id, present.map(visit => visit.id))}>{checkingOut === item.id ? 'Saving…' : 'Check out'}</button>}
        <button className={styles.rowOpen} aria-label={todayVisits.length ? 'Open family / payment' : 'Choose family'} disabled={!isToday || locked} onClick={() => void openFamily(item.id)}>Open</button>
      </div>
      <details className={styles.familyDetails}><summary>Details</summary>
        <p>{item.people.map(personName).join(', ') || 'No family members added'}</p>
        <p style={{ overflowWrap: 'anywhere' }}>{[item.email, item.phone].filter(Boolean).join(' · ')}</p>
        {item.reservations.map(reservation => <p key={reservation.id}><strong>Open Play reservation · {dateLabel(reservation.slot.starts_at)}</strong><br />{timeLabel(reservation.slot.starts_at)}–{timeLabel(reservation.slot.ends_at)} ET · {reservation.child_count} children / {reservation.adult_count} adults
          {reservation.admission_status && <><br />{reservationAdmissionLabel(reservation.admission_status, reservation.amount_cents)}</>}
        </p>)}
        {query.trim() && !item.reservations.length && <p>No Open Play reservations</p>}
        <p>{item.waiver_status === 'completed' ? 'Waiver completed' : 'Waiver needed'}</p>
        {todayVisits.map(visit => <p key={visit.id}>{visit.name} · {admissionPaymentLabel(visit)}{visit.checked_in_at && visit.checked_out_at && <> · In {admissionTime(visit.checked_in_at)} · Out {admissionTime(visit.checked_out_at)} · {stayLabel(stayMinutes(visit.checked_in_at, visit.checked_out_at))}</>}</p>)}
      </details>
    </article>;
  }

  return <main style={{ maxWidth: 1100, margin: '0 auto', padding: 24 }}>
    <StaffToolNav active="checkin" />
    <h1 style={{ color: '#4f3f82', marginBottom: 8 }}>Family check-in</h1>
    <nav aria-label="Check-in workspace" style={{ display: 'flex', gap: 16, margin: '16px 0' }}><Link href="/staff/open-play-reservations">Open Play reservations</Link><a href="#occupancy-management">Adjust occupancy ↓</a></nav>
    <div className={styles.workspace}><div className={styles.desk}>
    <p>Choose a reservation or search for a family.</p>
    <section style={panel}>
      <label htmlFor="family-search" style={{ fontWeight: 700 }}>Search families</label>
      <input id="family-search" type="search" value={query} disabled={locked} onChange={event => setQuery(event.target.value)} placeholder="Parent or child name, email, or phone" style={{ display: 'block', boxSizing: 'border-box', width: '100%', padding: 16, marginTop: 8, border: '1px solid #d9c8f7', borderRadius: 12, fontSize: 17 }} />
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <h2>{query.trim() ? 'Search results' : isToday ? 'Today’s reservations & visitors' : 'Reservations & visitors'}</h2>
        <button disabled={locked} onClick={() => { selectDeskDate(admissionDate(new Date().toISOString())); setDeskRefresh(value => value + 1); void refreshPayments().catch(error => setMessage(error.message)); }}>Show / refresh today</button>
        <Link href="/staff/families/new">+ New family</Link>
      </div>
      <div className={styles.dateNavigation} aria-label="Check-in date">
        <button type="button" aria-label="Previous day" disabled={locked} onClick={() => shiftDeskDate(-1)}>‹</button>
        <label><span className={styles.dateCaption}>Visit date · Eastern</span><input type="date" aria-label="Check-in date" value={deskDate} disabled={locked} onChange={event => { if (event.target.value) selectDeskDate(event.target.value); }} /></label>
        <button type="button" aria-label="Next day" disabled={locked} onClick={() => shiftDeskDate(1)}>›</button>
      </div>
      {!isToday && <p className={styles.boardNote}>Viewing {dateLabel(`${deskDate}T12:00:00Z`)}. Check-in status is for this date. Return to today to check in or collect payment.</p>}
      {deskError && <p role="alert">{deskError}</p>}
      {deskLoading ? <p role="status">Loading families…</p> : <>
        {truncated && <p>Many matches found. Enter a more specific name or email to narrow the list.</p>}
        {!families.length && !deskError && <p>{query.trim() ? 'No families found. Try another name, email, or phone.' : 'No reservations or visitors on this date. Search by name to find a family.'}</p>}
        {query.trim() ? <div className={styles.familyList}>{families.map(item => renderFamilyCard(familyArrival(item, boardVisits, deskDate)))}</div> : <div ref={arrivalBoard} className={styles.arrivalBoard}>
          {board.windows.length > 0 && <p className={styles.boardNote}>Times are Eastern. Swipe across each row. Families with all reserved children checked in turn green and move to the end.</p>}
          {board.windows.map(group => <section key={group.key} className={styles.arrivalWindow} aria-label={`${timeLabel(group.starts_at)} arrival window`}>
            <div className={styles.windowHeading}><h3>{timeLabel(group.starts_at)}–{timeLabel(group.ends_at)}</h3><span>{group.cards.length} {group.cards.length === 1 ? 'family' : 'families'} · {group.children} {group.children === 1 ? 'child' : 'children'} reserved · {group.cards.filter(card => !card.completed).length} waiting</span></div>
            <div className={styles.ageSummary} aria-label="Reserved children by age"><strong>Reserved ages</strong>{group.ages.map(bucket => <span key={bucket.age ?? 'unknown'}>{bucket.age === null ? 'Age missing' : `${bucket.age}yr old`}: {bucket.count}</span>)}</div>
            <div data-arrival-scroll className={styles.arrivalCards} tabIndex={0} role="region" aria-label={`${timeLabel(group.starts_at)} reserved families`}>{group.cards.map(card => renderFamilyCard(card, true))}</div>
          </section>)}
          {board.walkins.length > 0 && <section className={styles.arrivalWindow} aria-label="Walk-ins and visitors"><div className={styles.windowHeading}><h3>Walk-ins &amp; visitors</h3><span>No reservation for this date</span></div><div data-arrival-scroll className={styles.arrivalCards} tabIndex={0} role="region" aria-label="Walk-in families">{board.walkins.map(card => renderFamilyCard(card, true))}</div></section>}
        </div>}
      </>}
    </section>
    <section style={panel} aria-live="polite"><strong>{message}</strong>
      {needsVerification && <p><button style={button} disabled={busy} onClick={() => void verifyReturn()}>Retry payment verification</button></p>}
    </section>
    {family && <section ref={visitingFamily} style={{ ...panel, scrollMarginTop: 120 }} aria-label="Visiting family members">
      <h2>{family.name || 'Selected family'}</h2>
      <p><Link href={`/staff/families/${family.id}`}>Open family details / edit people</Link> · <Link href="/waiver" target="_blank">Family waiver</Link></p>
      <p><button disabled={locked || connectingCustomer} onClick={() => void connectSquareCustomer()}>{connectingCustomer ? 'Connecting Square customer…' : 'Connect Square customer for purchases'}</button></p>
      {squareCustomerMessage && <p role="status">{squareCustomerMessage}</p>}
      <p>Select everyone arriving now, including adults. Reserved headcounts are a reference; only selected people are checked in.</p>
      <button disabled={entriesLocked} onClick={() => setPeopleIds(peopleIds.length === notCheckedIn.length ? [] : notCheckedIn.map(person => person.id))}>{peopleIds.length && peopleIds.length === notCheckedIn.length ? 'Clear selection' : 'Select everyone remaining'}</button>
      <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
        {family.people.map(person => {
          const visit = familyVisits.find(visit => visit.person_id === person.id);
          return <label key={person.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 16, background: visit ? '#f0f7ef' : '#f7f3fc', borderRadius: 12 }}>
            <input type="checkbox" style={{ width: 24, height: 24 }} checked={!!visit || peopleIds.includes(person.id)} disabled={!!visit || entriesLocked} onChange={event => setPeopleIds(previous => event.target.checked ? [...previous, person.id] : previous.filter(id => id !== person.id))} />
            <span><strong>{personName(person)}</strong> · {person.role === 'child' ? 'Child' : 'Adult'}{visit && <span> · {visit.checked_out_at ? 'Checked out' : 'Checked in'} — {admissionPaymentLabel(visit)}</span>}</span>
          </label>;
        })}
      </div>
      {!family.people.length && <p>Add family members in Family Management before check-in.</p>}
      {waiverBlocked && <aside style={{ marginTop: 16, padding: 16, border: '1px solid #d9a145', borderRadius: 12, background: '#fff3d9', color: '#69420d' }}>
        <h3 style={{ marginTop: 0 }}>Check-in blocked — family waiver needed</h3>
        <p>Ask the parent or legal guardian to open <a href="/waiver" target="_blank" rel="noreferrer">thelittlewanderers.com/waiver</a> on their own device, sign in to the account showing these children, and complete the waiver.</p>
        <p>After signing, recheck here. Your visitor selection will stay selected.</p>
        <button type="button" disabled={locked || loading} onClick={() => void openFamily(family.id, true)}>Recheck waiver</button>
        <p><a href="#admission-help">Already signed? Find and connect the waiver below.</a></p>
      </aside>}
      {checkinBlockReason && <p id="checkin-block-reason" style={{ color: waiverBlocked ? '#8a4b0f' : '#655876', fontWeight: 600 }}>{checkinBlockReason}</p>}
      <p><button type="button" style={{ ...button, ...(checkinDisabled ? { background: '#e4dfeb', color: '#62586d', cursor: 'not-allowed' } : {}) }} disabled={checkinDisabled} aria-describedby={checkinBlockReason ? 'checkin-block-reason' : undefined} onClick={() => void checkInFamily()}>{checkingIn ? 'Recording visits…' : waiverBlocked ? 'Waiver required before check-in' : `Check in ${peopleIds.length || ''} selected visitors`}</button></p>
      <p role="status" aria-live="polite">{message}</p>
    </section>}
    {isToday && <section style={panel} aria-label="Family payment">
      <h2>Family payment</h2>
      {staffMode && <p>Staff screen: <strong>{staffMode === 'home-screen' ? 'Home Screen app' : 'browser tab'}</strong>.{staffMode === 'home-screen' && ' Square returns to Safari. Reopen this icon to refresh, or start from a Safari tab for return to the same browser.'}</p>}
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
        <p><a href="#admission-help">Already paid directly in Square? Connect the receipt below.</a></p>
      </> : !loading && <p>{paymentUnverified ? 'Square payment needs verification. Do not collect again; refresh payment status or check its receipt.' : familyVisits.length ? 'No admission payment due for this family. Paid visits, members and prepaid visitors are already accounted for.' : 'Check in a family to see their total here.'}</p>}
      {pendingSale && <aside style={{ marginTop: 20, padding: 16, background: '#fff1d8', borderRadius: 12 }}><h3>Square checkout needs review</h3><p>If Square was cancelled, did not open, or did not return a receipt, check Transactions on this iPad first. Wait at least one minute after the launch. Never reset while a payment is pending or saved offline.</p><label><input type="checkbox" checked={recoveryConfirmed} disabled={busy} onChange={event => setRecoveryConfirmed(event.target.checked)} /> I checked Square: this checkout is closed, with no completed, pending or offline payment.</label><p><button disabled={busy || !recoveryConfirmed} onClick={() => void recoverPayment()}>Reconcile Square and reset unpaid checkout</button></p><p>The server checks Square too. If it finds a completed matching payment, it records payment instead of starting another charge.</p></aside>}
      {launchUrl && <p><a href={launchUrl} style={{ fontWeight: 700 }}>Open Square{selected ? ` — ${money(selected.total)}` : ''}</a>. Use the same payment; do not start a separate sale.</p>}
      <p><button disabled={busy || checkingIn} onClick={() => void resumePayments()}>Refresh payment status</button></p>
    </section>}
    <AdmissionHelp family={family} date={deskDate} disabled={busy || loading || checkingIn || !!checkingOut || !!completion} onOpenFamily={id => { void openFamily(id); }} onUpdated={() => {
      void refreshPayments(); setDeskRefresh(value => value + 1); if (family) void openFamily(family.id, true);
    }} />
    </div><aside className={styles.occupancy} aria-label="Live occupancy management">
      <p>Use family check-out to record departures and update occupancy. The controls below are for other count corrections.</p>
      <StaffDashboard view="occupancy" refreshKey={deskRefresh} />
    </aside></div>
    <details style={{ marginTop: 24 }}><summary style={{ cursor: 'pointer', fontWeight: 700 }}>Visit reports</summary><AdmissionStayStatistics refreshKey={deskRefresh} /></details>
    {completion && <dialog ref={completionDialog} className={styles.completionDialog} aria-labelledby="checkin-complete-title" onCancel={event => { if (busy) event.preventDefault(); }} onClose={returnToDesk}>
      <h2 id="checkin-complete-title">Check-in complete</h2>
      <p><strong>{completion.familyName}</strong></p>
      <p>{completion.visitors.length} visitor{completion.visitors.length === 1 ? '' : 's'} checked in. Their admission records are saved.</p>
      <ul>{completion.visitors.map((name, index) => <li key={index}>{name}</li>)}</ul>
      {selected ? <>
        <p style={{ fontSize: 26 }}><strong>Total due: {money(selected.total)}</strong></p>
        <p>Continue to Square on this iPad to collect this family’s payment.</p>
        {!enabled && <p>Square handoff is currently closed. Admission is saved; collect payment at the counter.</p>}
        <button type="button" style={button} disabled={!enabled || busy || loading || !paymentsReady || !!pendingSale || !!launchUrl || needsVerification} onClick={() => void takePayment()}>Continue to Square — {money(selected.total)}</button>
      </> : paymentUnverified ? <p><strong>Checking Square payment.</strong> Do not collect again. Refresh payment status to verify the receipt.</p> : <p><strong>No admission payment due.</strong> Membership, included or prepaid admission has been applied.</p>}
      <p role="status" aria-live="polite">{message}</p>
      <p><button type="button" disabled={busy} onClick={returnToDesk}>{selected ? 'Back to desk' : 'Done'}</button></p>
    </dialog>}
  </main>;
}
