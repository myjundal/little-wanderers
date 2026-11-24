'use client';
import Link from 'next/link';
import Image from 'next/image';
import BookingWaiverNextStep from '@/components/waivers/BookingWaiverNextStep';
import { useCallback, useEffect, useState } from 'react';
import styles from './soft-opening.module.css';
import { formatBirthdateInput } from '@/lib/birthdate';
import { parseOpenPlayBirthdate } from '@/lib/open-play-birthdate';
import { PUBLIC_OPEN_PLAY_START_DATE, SOFT_OPENING_START_DATE, isLastOpenPlayArrival, LAST_OPEN_PLAY_ARRIVAL_NOTICE } from '@/lib/open-play-reservations';
import { softOpeningAmount } from '@/lib/soft-opening-pricing';
type Child = {
    id?: string;
    new_id?: string;
    first_name?: string;
    last_name?: string | null;
    birthdate?: string | null;
    name?: string;
    birthdate_needs_confirmation?: boolean;
    selected?: boolean;
};
type Membership = {
    child_ids: string[];
    status: string;
    start_date: string | null;
    paid_through: string | null;
};
type Slot = {
    id: string;
    starts_at: string;
    ends_at: string;
    remaining_children: number;
    capacity_children: number;
    is_closed: boolean;
    is_full: boolean;
    is_private_party_blocked?: boolean;
};
type Reservation = {
    id: string;
    slot_id?: string;
    child_count: number;
    adult_count: number;
    payment_choice: string;
    payment_status: string;
    amount_cents: number;
    status: string;
    slot?: Slot;
};
export type SoftOpeningData = {
    ok?: boolean;
    allowed?: boolean;
    error?: string;
    slots?: Slot[];
    reservations?: Reservation[];
    private_party_days?: { date: string; starts_at: string; ends_at: string }[];
    family?: {
        guardian: {
            first_name: string | null;
            last_name: string | null;
        } | null;
        children: Child[];
        memberships: Membership[];
    };
};
const dayKey = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
const hour = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const dateLabel = (date: string) => !date ? 'Choose a date' : new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
export default function SoftOpeningReservation({ previewData, publicBooking = false }: {
    previewData?: SoftOpeningData;
    publicBooking?: boolean;
}) {
    const earliestDate = publicBooking ? PUBLIC_OPEN_PLAY_START_DATE : SOFT_OPENING_START_DATE;
    const reservationsUrl = `/api/open-play-reservations${publicBooking ? '?source=public' : ''}`;
    const signInHref = `/login?next=${encodeURIComponent(publicBooking ? '/landing/open-play' : '/landing/soft-opening')}`;
    const [data, setData] = useState<SoftOpeningData | null>(previewData ?? null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [success, setSuccess] = useState('');
    const [date, setDate] = useState(earliestDate), [slotId, setSlotId] = useState(''), [first, setFirst] = useState(''), [last, setLast] = useState('');
    const [children, setChildren] = useState<Child[]>([]), [adults, setAdults] = useState('1'), [choice, setChoice] = useState('counter'), [notes, setNotes] = useState('');
    const [closingConfirmed, setClosingConfirmed] = useState(false);
    const preview = Boolean(previewData);
    const [confirmedReservation, setConfirmedReservation] = useState('');
    const completeBooking = useCallback((id: string) => {
        setConfirmedReservation(id);
        setSuccess('Your visit is reserved. We look forward to welcoming your family!');
        setBusy(false);
        const url = new URL(window.location.href);
        url.searchParams.delete('payment'); url.searchParams.delete('reservation');
        window.history.replaceState({}, '', url);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }, []);
    const populate = useCallback((json: SoftOpeningData) => { setData(json); setFirst(json.family?.guardian?.first_name === 'Guardian' ? '' : json.family?.guardian?.first_name ?? ''); setLast(json.family?.guardian?.last_name ?? ''); setChildren(json.family?.children.length ? json.family.children.map(c => ({ ...c, name: [c.first_name, c.last_name].filter(Boolean).join(' '), birthdate: c.birthdate_needs_confirmation || !parseOpenPlayBirthdate(c.birthdate) ? '' : formatBirthdateInput(c.birthdate!), selected: true })) : [{ new_id: crypto.randomUUID(), name: '', birthdate: '', selected: true }]); const requestedId = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('slot') : null; const requested = json.slots?.find(slot => slot.id === requestedId && !slot.is_closed && !slot.is_full); const firstSlot = requested ?? json.slots?.find(slot => dayKey(slot.starts_at) >= earliestDate); if (firstSlot) { setDate(dayKey(firstSlot.starts_at)); if (requested) setSlotId(requested.id); } }, [earliestDate]);
    useEffect(() => { if (previewData) {
        populate(previewData);
        return;
    } let active = true; fetch(reservationsUrl, { cache: 'no-store' }).then(r => r.json()).then(json => { if (active)
        populate(json); }).catch(() => { if (active)
        setError('Unable to load reservations. Please refresh to try again.'); }); return () => { active = false; }; }, [previewData, reservationsUrl, populate]);
    useEffect(() => { if (preview)
        return; const params = new URLSearchParams(window.location.search); const id = params.get('reservation'); if (params.get('payment') !== 'returned' || !id)
        return; setBusy(true); fetch(`/api/open-play-reservations/${encodeURIComponent(id)}/payment`, { cache: 'no-store' }).then(r => r.json()).then(json => { if (!json.ok)
        throw new Error(json.error); if (!['paid', 'covered'].includes(json.reservation?.payment_status)) throw new Error('Your visit is reserved, but payment confirmation is still pending. Do not pay again. Refresh this page to check again or ask the front desk for help.'); completeBooking(id); }).catch(e => { setError(e.message); setBusy(false); }); }, [preview, completeBooking]);
    const slots = (data?.slots ?? []).filter(s => dayKey(s.starts_at) >= earliestDate && dayKey(s.starts_at) === date);
    const privateDay = data?.private_party_days?.find(day => day.date === date);
    const lastArrival = slots.filter(slot => !slot.is_closed && (!privateDay || Date.parse(slot.ends_at) <= Date.parse(privateDay.starts_at))).at(-1);
    const reservedSlotIds = new Set((data?.reservations ?? []).filter(r => r.status !== 'cancelled').map(r => r.slot_id ?? r.slot?.id));
    const selected = slots.find(s => s.id === slotId && !reservedSlotIds.has(s.id)) ?? null;
    const needsClosingConfirmation = Boolean(selected && isLastOpenPlayArrival(selected));
    const participating = children.filter(c => c.selected);
    const pricingChildren = participating.map((child, i) => ({ id: child.id ?? `new-${i}`, birthdate: parseOpenPlayBirthdate(child.birthdate) }));
    const birthdaysReady = pricingChildren.every(child => Boolean(child.birthdate));
    const amount = softOpeningAmount(pricingChildren.map(child => child.id), data?.family?.memberships ?? [], date, pricingChildren);
    const reservations = (data?.reservations ?? []).filter(r => r.status === 'reserved' && r.slot && new Date(r.slot.ends_at) > new Date()).sort((a, b) => Date.parse(a.slot!.starts_at) - Date.parse(b.slot!.starts_at));
    function patchChild(index: number, patch: Partial<Child>) { setChildren(cs => cs.map((c, i) => i === index ? { ...c, ...patch } : c)); }
    async function pay(id: string) { setBusy(true); setError(''); try {
        const response = await fetch(`/api/open-play-reservations/${id}/payment`, { method: 'POST' });
        const json = await response.json();
        if (!response.ok || !json.ok)
            throw new Error(json.error);
        if (json.url) window.location.assign(json.url);
        else completeBooking(id);
    }
    catch (e) {
        setError(e instanceof Error ? e.message : 'Please try again.');
        setBusy(false);
    } }
    async function reserve(event: React.FormEvent) { event.preventDefault(); if (!selected)
        return; setError(''); if (!birthdaysReady) { setError('Please enter a valid birthday for every selected child. Use the same birthday on your family waiver.'); return; } if (needsClosingConfirmation && !closingConfirmed) { setError('Please confirm that our 6 PM closing time works for your visit.'); return; } if (preview) {
        setSuccess('Preview: your visit is reserved. Next, complete the family waiver.');
        return;
    } setBusy(true); try {
        const response = await fetch('/api/open-play-reservations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ booking_source: publicBooking ? 'public' : 'invitation', slot_id: selected.id, adult_count: Number(adults), guardian_first_name: first, guardian_last_name: last, children: participating.map(c => ({ id: c.id, new_id: c.new_id, name: c.name, birthdate: parseOpenPlayBirthdate(c.birthdate) })), payment_choice: choice, notes }) });
        const json = await response.json();
        if (!response.ok || !json.ok) {
            if (json.code === 'private_party') {
                const latest = await (await fetch(reservationsUrl, { cache: 'no-store' })).json();
                if (latest.ok) { setData(current => ({ ...current, slots: latest.slots, private_party_days: latest.private_party_days })); setSlotId(''); }
            }
            throw new Error(json.error);
        }
        setData(current => ({ ...current, reservations: [{ ...json.reservation, slot: selected }, ...(current?.reservations ?? [])] }));
        if (choice === 'now' && json.reservation.amount_cents > 0)
            await pay(json.reservation.id);
        else
            completeBooking(json.reservation.id);
    }
    catch (e) {
        setError(e instanceof Error ? e.message : 'Please try again.');
        setBusy(false);
    } }
    async function cancel(id: string) { setBusy(true); setError(''); try {
        const response = await fetch(`/api/open-play-reservations/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'cancel' }) });
        const json = await response.json();
        if (!response.ok || !json.ok)
            throw new Error(json.error);
        populate(await (await fetch(reservationsUrl, { cache: 'no-store' })).json());
        if (confirmedReservation === id) setConfirmedReservation('');
        setSuccess('Your reservation has been canceled.');
    }
    catch (e) {
        setError(e instanceof Error ? e.message : 'Please try again.');
    }
    finally {
        setBusy(false);
    } }
    return <main className={styles.main}>
  {preview && <div className={styles.preview}>OWNER PREVIEW · Sample availability · No booking or charge is created</div>}
  <header className={styles.hero}><div><span className={styles.eyebrow}>Open play reservations</span><h1>Come wander<br />with us.</h1><p>Our doors are open. Reserve an arrival window and come play with us.</p><div className={styles.tags}><span>Open daily · 9am–6pm</span><span>6 children per hourly arrival window</span></div></div><div className={styles.photo}><Image src="/play-studio.jpg" alt="The Little Wanderers play studio" fill sizes="(max-width: 700px) 100vw, 430px" priority/><span>Big adventures. Little wanderers.</span></div></header>
  <div className={styles.info}><strong>ARRIVAL WINDOW · UNLIMITED STAY</strong><p>Your reserved hour is your <b>ARRIVAL WINDOW</b>. Arrive any time within it, then enjoy <b>UNLIMITED STAY until closing</b>. <strong>Weekend reservations are highly recommended.</strong> Our usual last arrival window is 4–5 PM, and we close at 6 PM. Check your selected date for private-event hours.</p><p>Open daily, 9am–6pm. All times Eastern. All hours are subject to scheduled private events; check the calendar for availability.</p></div>
  {error && <p className={styles.error} role="alert">{error}</p>}{success && <p className={styles.success} role="status">{success}</p>}
  {!data && !error ? <p role="status">Loading your family and visit times…</p> : data && !data.ok ? <section className={styles.card}><h2>Come play with us.</h2><p>All families are welcome. Sign in or create your free account to reserve.</p><Link className={styles.primary} href={signInHref}>Sign in / Create account</Link><p>{data.error}</p></section> : data?.ok && <>
  {!preview && (confirmedReservation || reservations.length > 0) && <BookingWaiverNextStep key={confirmedReservation || 'existing'}
    returnTo={publicBooking ? '/landing/open-play' : '/landing/soft-opening'}
    reservationId={confirmedReservation || reservations[0]?.id}
    promptKey={confirmedReservation || undefined}
  />}
  {reservations.length > 0 && <section className={styles.visits} aria-label="Your upcoming visits"><h2>Your upcoming visits</h2><p>You can reserve multiple visits. Choose another date or arrival window below to add a visit.</p>{reservations.map(reservation => <section key={reservation.id} className={styles.card}><span className={styles.eyebrow}>Your visit is reserved</span><h2>{dateLabel(dayKey(reservation.slot!.starts_at))}</h2><p>ARRIVAL WINDOW: {hour(reservation.slot!.starts_at)}–{hour(reservation.slot!.ends_at)} · {reservation.child_count} child{reservation.child_count === 1 ? '' : 'ren'}</p><p><strong>UNLIMITED STAY until closing.</strong></p>{isLastOpenPlayArrival(reservation.slot!) && !data?.private_party_days?.some(day => day.date === dayKey(reservation.slot!.starts_at)) && <p className={styles.closingNotice}>Your arrival window is 4–5 PM. We close at 6 PM, so please plan to finish your visit by then.</p>}{data?.private_party_days?.filter(day => day.date === dayKey(reservation.slot!.starts_at)).map(day => <p key={day.date} role="status">{Date.parse(reservation.slot!.ends_at) > Date.parse(day.starts_at) && Date.parse(reservation.slot!.starts_at) < Date.parse(day.ends_at) ? <>Your reserved arrival overlaps this date’s private-party closure ({hour(day.starts_at)}–{hour(day.ends_at)}). Please <Link href="/landing/contact">contact us</Link> to arrange a change before coming.</> : <>Open Play ends at {hour(day.starts_at)} on this date for a private party. Please finish your visit by then.</>}</p>)}<p>{reservation.payment_status === 'paid' ? 'Paid online' : reservation.payment_status === 'covered' ? 'Admission included' : `${money(reservation.amount_cents)} · ${reservation.payment_choice === 'now' ? 'Online payment pending' : 'Pay at the counter'}`}</p><div className={styles.actions}>{reservation.payment_status === 'due' && <button disabled={busy} onClick={() => void pay(reservation.id)}>Pay now</button>}{reservation.payment_choice !== 'now' && reservation.payment_status !== 'paid' && <button disabled={busy} onClick={() => void cancel(reservation.id)}>Cancel reservation</button>}</div>{(reservation.payment_choice === 'now' || reservation.payment_status === 'paid') && <p>Need to change or cancel this visit? <Link href="/landing/contact">Contact us</Link> so we can review your payment.</p>}</section>)}</section>}
  <form onSubmit={reserve} className={styles.layout}>
  <div className={styles.steps}>
   <section className={styles.card}><div className={styles.heading}><span>1</span><h2>Your family</h2></div><p>We’ve filled in what we have. Please confirm each child’s name and birthday. Use the same birthday on your family waiver so your reservation and waiver stay together.</p><div className={styles.two}><label>Parent / guardian first name<input autoComplete="given-name" required maxLength={80} value={first} onChange={e => setFirst(e.target.value)}/></label><label>Last name<input autoComplete="family-name" required maxLength={80} value={last} onChange={e => setLast(e.target.value)}/></label></div><h3>Who’s coming to play?</h3><p className={styles.muted}>Choose up to 5 children for this arrival window.</p>{children.map((child, i) => <div className={styles.child} key={child.id ?? `new-${i}`}><label className={styles.check}><input type="checkbox" checked={Boolean(child.selected)} onChange={e => patchChild(i, { selected: e.target.checked })}/>Child {i + 1}</label>{child.selected && <><label>Child’s name<input required maxLength={80} value={child.name ?? ''} onChange={e => patchChild(i, { name: e.target.value })}/></label><label>Birthday (MM/DD/YY or MM/DD/YYYY)<input inputMode="numeric" placeholder="MM/DD/YY or MM/DD/YYYY" required maxLength={10} aria-invalid={Boolean(child.birthdate && !parseOpenPlayBirthdate(child.birthdate))} aria-describedby={child.birthdate && !parseOpenPlayBirthdate(child.birthdate) ? `birthday-error-${i}` : undefined} value={child.birthdate ?? ''} onChange={e => patchChild(i, { birthdate: formatBirthdateInput(e.target.value) })}/></label>{child.birthdate && !parseOpenPlayBirthdate(child.birthdate) && <p id={`birthday-error-${i}`} className={styles.error}>Enter a valid birthday on or before today.</p>}{child.birthdate_needs_confirmation && <p className={styles.muted}>Please enter the actual birthday to confirm the age previously on file.</p>}</>}</div>)}{children.length < 10 && <button disabled={participating.length >= 5} type="button" onClick={() => setChildren(cs => [...cs, { new_id: crypto.randomUUID(), name: '', birthdate: '', selected: true }])}>+ Add a child</button>}<label className={styles.adults}>Adults<select value={adults} onChange={e => setAdults(e.target.value)}><option value="1">1 adult</option><option value="2">2 adults</option></select></label><p className={styles.muted}>Up to 2 accompanying adults included. Please reserve for every child attending.</p></section>
   <section className={styles.card}><div className={styles.heading}><span>2</span><h2>Choose your ARRIVAL WINDOW</h2></div><label>Visit date<input type="date" min={earliestDate} max="2026-12-31" value={date} onChange={e => { setDate(e.target.value); setSlotId(''); setClosingConfirmed(false); }} required/></label><h3>{dateLabel(date)}</h3>{privateDay && <p role="status">Open Play on this date ends at {hour(privateDay.starts_at)} for a private party. Please finish your visit by then.{lastArrival && <> The last arrival window is {hour(lastArrival.starts_at)}–{hour(lastArrival.ends_at)}.</>}</p>}<div className={styles.times}>{slots.map(slot => <button type="button" key={slot.id} className={selected?.id === slot.id ? styles.selected : ''} disabled={reservedSlotIds.has(slot.id) || slot.is_closed || slot.is_full || slot.remaining_children < participating.length} aria-pressed={selected?.id === slot.id} onClick={() => { setSlotId(slot.id); setClosingConfirmed(false); }}><strong>{hour(slot.starts_at)}–{hour(slot.ends_at)}</strong><small>{reservedSlotIds.has(slot.id) ? 'Already reserved' : slot.is_private_party_blocked ? 'Private party' : slot.is_closed ? 'Closed' : `(${slot.remaining_children}/${slot.capacity_children}) spots left${slot.is_full ? ' · Full' : ''}`}</small></button>)}</div>{!slots.length && <p>No arrival windows available on this date. Please choose another day.</p>}</section>
  </div>
  <aside className={styles.summary}><div className={styles.card}><span className={styles.eyebrow}>Your first little adventure</span><h2>A visit, at your pace.</h2><div className={styles.priceRow}><span>First child, 12+ months / visit</span><strong>$16</strong></div><div className={styles.priceRow}><span>Each additional child (6+ months)</span><strong>$10</strong></div><p className={styles.muted}>Under 6 months: free. Ages 6–11 months: $10 per child. Please include every child in your reservation.</p><div className={styles.member}><strong>Members play free.</strong><p>Admission is included for enrolled children. Membership billing starts on your first membership visit.</p><Link href="/landing/membership">Explore monthly membership →</Link></div><p>{participating.length} child{participating.length === 1 ? '' : 'ren'} · {adults} adult{adults === '1' ? '' : 's'}</p><p>{selected ? `${dateLabel(date)} · ${hour(selected.starts_at)}–${hour(selected.ends_at)}` : 'Choose your arrival window'}</p><p><strong>UNLIMITED STAY until closing.</strong></p>{needsClosingConfirmation && <div className={styles.closingNotice} role="status"><p><strong>{LAST_OPEN_PLAY_ARRIVAL_NOTICE}</strong></p><label className={styles.check}><input type="checkbox" required checked={closingConfirmed} onChange={e => setClosingConfirmed(e.target.checked)}/>Yes, I understand that we close at 6 PM.</label></div>}<div className={styles.total}><span>Visit total</span><strong>{birthdaysReady ? money(amount) : 'Enter birthdays'}</strong></div>{birthdaysReady && amount === 0 && participating.length > 0 ? <p className={styles.muted}>Admission included for your selected children. No admission payment needed.</p> : <fieldset><legend>How would you like to pay?</legend><label className={styles.pay}><input type="radio" name="payment" value="counter" checked={choice === 'counter'} onChange={() => setChoice('counter')}/><span><strong>Pay at the counter</strong><small>Reserve now, pay when you arrive.</small></span></label><label className={styles.pay}><input type="radio" name="payment" value="now" checked={choice === 'now'} onChange={() => setChoice('now')}/><span><strong>Pay now</strong><small>Secure online checkout with Square.</small></span></label></fieldset>}<label>Anything we should know? <span className={styles.muted}>(optional)</span><textarea value={notes} maxLength={500} rows={2} onChange={e => setNotes(e.target.value)}/></label><button className={styles.primary} type="submit" disabled={busy || !birthdaysReady || !selected || reservedSlotIds.has(selected.id) || (needsClosingConfirmation && !closingConfirmed) || participating.length < 1 || participating.length > 5 || Boolean(selected && selected.remaining_children < participating.length)}>{busy ? 'Saving your visit…' : choice === 'now' && amount > 0 ? 'Reserve & pay now →' : 'Reserve my visit →'}</button><p className={styles.next}>After reserving, we’ll check your family waiver and guide you to sign if needed.</p></div><p className={styles.footer}>We look forward to welcoming your family.</p></aside>
  </form></>}
 </main>;
}
