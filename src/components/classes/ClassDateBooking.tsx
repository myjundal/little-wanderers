'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CLASS_TERM_END_AT, CLASS_HOLIDAY_DATE } from '@/lib/class-config';
import styles from './class-registration.module.css';

type Session = { id: string; title: string; start_time: string; end_time: string; price_cents: number; seats_left: number | null; schedule_label: string | null; age_range?: string | null; instructor_name?: string | null };
type Registration = { person_id: string; status: string; class: { id: string } | null };
type Checkout = { id: string; status: string; payment_url: string | null; total_price_cents: number; person_id: string; class_ids: string[]; expires_at: string; summary?: { registration_count: number } | null };
const STORAGE_KEY = 'lw-class-date-selection-v1';
const money = (amount: number) => `$${(amount / 100).toFixed(2)}`;
const day = (iso: string) => new Date(iso).toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric' });
const time = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
export default function ClassDateBooking({ classes, registrations, selectedChildId, authenticated, resolveChild, onPaid, onRestoreChild }: {
  classes: Session[]; registrations: Registration[]; selectedChildId: string; authenticated: boolean;
  resolveChild: () => Promise<{ id: string; guardian_first_name: string; guardian_last_name: string }>;
  onPaid: () => void; onRestoreChild: (id: string) => void;
}) {
  const [selected, setSelected] = useState<{ personId: string; ids: string[] }>({ personId: '', ids: [] });
  const [checkout, setCheckout] = useState<Checkout | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const mounted = useRef(false);
  const confirmed = useRef('');
  const callbacks = useRef({ onPaid, onRestoreChild });
  callbacks.current = { onPaid, onRestoreChild };
  const sessions = useMemo(() => classes.filter(row => row.title !== 'Little Hands, Big Canvases' && row.price_cents > 0
    && Date.parse(row.start_time) < Date.parse(CLASS_TERM_END_AT)
    && new Date(row.start_time).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }) !== CLASS_HOLIDAY_DATE), [classes]);
  const groups = useMemo(() => {
    const result = new Map<string, Session[]>();
    for (const row of sessions) result.set(row.title, [...(result.get(row.title) ?? []), row]);
    return [...result].map(([title, dates]) => ({ title, dates: dates.sort((a,b) => Date.parse(a.start_time) - Date.parse(b.start_time)) }));
  }, [sessions]);
  const locked = Boolean(checkout && !['completed', 'cancelled'].includes(checkout.status));
  const ids = selected.personId === selectedChildId || !selected.personId ? selected.ids : [];
  const selectedSessions = sessions.filter(row => ids.includes(row.id));
  const total = selectedSessions.reduce((sum, row) => sum + row.price_cents, 0);
  const changeSelection = (nextIds: string[]) => {
    const next = { personId: selectedChildId, ids: nextIds };
    setSelected(next); setError(''); setNotice('');
    if (checkout?.status === 'completed') setCheckout(null);
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch {}
  };
  const applyCheckout = useCallback((current: Checkout | null) => {
    setCheckout(current);
    if (!current) return;
    if (current.status === 'completed') {
      if (confirmed.current === current.id) return;
      confirmed.current = current.id;
      setSelected({ personId: '', ids: [] });
      try { sessionStorage.removeItem(STORAGE_KEY); } catch {}
      setNotice(`Payment confirmed — ${current.summary?.registration_count ?? current.class_ids.length} class date(s) reserved.`);
      callbacks.current.onPaid();
      const url = new URL(window.location.href); url.searchParams.delete('checkout_id'); window.history.replaceState({}, '', url);
    } else if (current.status === 'cancelled') {
      setCheckout(null); setNotice('Unpaid checkout closed. You can choose your dates again.');
    } else {
      setSelected({ personId: current.person_id, ids: current.class_ids });
      callbacks.current.onRestoreChild(current.person_id);
      if (current.status === 'needs_review') setError('Payment received and awaiting staff review. Please contact us before paying again.');
    }
  }, []);
  const request = useCallback(async (body: Record<string, unknown>) => {
    const response = await fetch('/api/classes/checkout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store' });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || 'Unable to check payment. Please refresh before paying again.');
    return data.checkout as Checkout | null;
  }, []);
  useEffect(() => {
    if (mounted.current) return;
    mounted.current = true;
    try { const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || 'null'); if (saved && Array.isArray(saved.ids) && saved.ids.every((id: unknown) => typeof id === 'string')) setSelected({ personId: saved.personId || '', ids: saved.ids }); } catch {}
  }, []);
  useEffect(() => {
    if (!authenticated) { setRestoring(false); return; }
    let active = true;
    setRestoring(true);
    const id = new URLSearchParams(window.location.search).get('checkout_id');
    request(id ? { mode: 'finalize', checkout_id: id } : { mode: 'current' }).then(current => { if (active) applyCheckout(current); })
      .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'Unable to check your pending payment.'); })
      .finally(() => { if (active) setRestoring(false); });
    return () => { active = false; };
  }, [authenticated, request, applyCheckout]);
  useEffect(() => {
    if (!checkout || !['creating', 'open'].includes(checkout.status)) return;
    let active = true;
    const verify = () => request({ mode: 'finalize', checkout_id: checkout.id }).then(current => { if (active) applyCheckout(current); }).catch(() => {});
    const interval = window.setInterval(verify, 8000);
    window.addEventListener('focus', verify);
    return () => { active = false; window.clearInterval(interval); window.removeEventListener('focus', verify); };
  }, [checkout, request, applyCheckout]);
  const start = async () => {
    if (busy || locked || restoring || !selectedSessions.length) return;
    if (!authenticated) {
      const next = '/landing/classschedule';
      sessionStorage.setItem('post_login_redirect', next);
      window.location.assign(`/login?mode=new&next=${encodeURIComponent(next)}`); return;
    }
    setBusy(true); setError('');
    try {
      const child = await resolveChild();
      const current = await request({ person_id: child.id, items: selectedSessions.map(row => ({ class_id: row.id, quantity: 1 })), guardian_first_name: child.guardian_first_name, guardian_last_name: child.guardian_last_name });
      applyCheckout(current);
      if (current?.payment_url && current.status === 'open') window.location.assign(current.payment_url);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to open checkout.'); }
    finally { setBusy(false); }
  };
  const close = async () => {
    if (!checkout || busy) return;
    setBusy(true); setError('');
    try { applyCheckout(await request({ mode: 'cancel', checkout_id: checkout.id })); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to close checkout. Please refresh.'); }
    finally { setBusy(false); }
  };
  if (!sessions.length) return null;
  return <section className={styles.booking} aria-label="Choose class dates and pay">
    <header><p className={styles.eyebrow}>November 16 – December 17</p><h2>Choose your dates & pay</h2><p>Open to all families. Pick any combination of classes and dates for the child selected above, then pay once.</p><p>No classes on Thanksgiving, November 26. Ms. Jamie’s art series has its own registration below.</p></header>
    <div className={styles.dateGroups}>{groups.map(group => <fieldset key={group.title} disabled={locked || busy || restoring} className={styles.dateGroup}>
      <legend>{group.title} <span>{money(group.dates[0].price_cents)} / class</span></legend>
      <p>{time(group.dates[0].start_time)}–{time(group.dates[0].end_time)} · Eastern{group.dates[0].age_range ? ` · Ages ${group.dates[0].age_range}` : ''}{group.dates[0].instructor_name ? ` · ${group.dates[0].instructor_name}` : ''}</p>
      {group.title === 'Baby Music' && <p>30 minutes of guided music + 15 minutes of free play with instruments.</p>}
      <div className={styles.dateChoices}>{group.dates.map(row => {
        const booked = registrations.some(reg => reg.person_id === selectedChildId && reg.class?.id === row.id && ['scheduled', 'attended'].includes(reg.status));
        const full = row.seats_left === 0;
        const interested = registrations.some(reg => reg.person_id === selectedChildId && reg.class?.id === row.id && reg.status === 'preregistered');
        return <label key={row.id} className={`${styles.dateChoice} ${ids.includes(row.id) ? styles.dateChosen : ''}`}><input type="checkbox" checked={ids.includes(row.id)} disabled={booked || full} onChange={event => changeSelection(event.target.checked ? [...ids, row.id] : ids.filter(id => id !== row.id))} /><span>{day(row.start_time)}{booked ? <small>Confirmed</small> : full ? <small>Full</small> : interested ? <small>Your saved interest</small> : null}</span></label>;
      })}</div>
    </fieldset>)}</div>
    <div className={styles.cart} aria-label="Class cart">
      <h3>Your class dates</h3>
      {selectedSessions.length ? <ul>{selectedSessions.map(row => <li key={row.id}><span>{row.title}<small>{day(row.start_time)} · {time(row.start_time)} Eastern</small></span><strong>{money(row.price_cents)}</strong>{!locked && <button type="button" onClick={() => changeSelection(ids.filter(id => id !== row.id))} aria-label={`Remove ${row.title}, ${day(row.start_time)}`}>×</button>}</li>)}</ul> : <p>Select the dates you would like to attend.</p>}
      {locked ? <><p><strong>Checkout total: {money(checkout!.total_price_cents)}</strong></p>{checkout?.payment_url && checkout.status === 'open' && <a href={checkout.payment_url} className={styles.payButton}>Continue to secure payment</a>}<p>Your place is confirmed after payment. Complete this checkout or close it before choosing different dates.</p>{checkout?.status !== 'needs_review' && <div className={styles.cartActions}><button type="button" disabled={busy} onClick={() => { void request({ mode: 'finalize', checkout_id: checkout!.id }).then(applyCheckout).catch(reason => setError(reason.message)); }}>Check payment</button><button type="button" disabled={busy} onClick={() => void close()}>Close unpaid checkout & change dates</button></div>}</>
        : <><div className={styles.cartTotal}><span>{selectedSessions.length} date(s)</span><strong>Total {money(total)}</strong></div><button type="button" className={styles.payButton} disabled={busy || restoring || !selectedSessions.length} onClick={() => void start()}>{busy ? 'Preparing secure payment…' : restoring ? 'Checking pending payment…' : authenticated ? `Pay ${money(total)} & reserve dates` : 'Sign in / create account to pay'}</button><p>Only completed payment confirms your place. Prices are per class and per child.</p></>}
      {notice && <p role="status" className={styles.confirmation}>{notice}</p>}
      {error && <p role="alert" className={styles.error}>{error}</p>}
    </div>
  </section>;
}
