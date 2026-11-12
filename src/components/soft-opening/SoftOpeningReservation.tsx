'use client';
import Link from 'next/link';
import Image from 'next/image';
import { useCallback, useEffect, useState } from 'react';
import styles from './soft-opening.module.css';
import { parseChildAge } from '@/lib/child-age';
import { PUBLIC_OPEN_PLAY_START_DATE, SOFT_OPENING_START_DATE } from '@/lib/open-play-reservations';
import { softOpeningAmount } from '@/lib/soft-opening-pricing';
type Child = {
    id?: string;
    new_id?: string;
    first_name?: string;
    last_name?: string | null;
    birthdate?: string | null;
    name?: string;
    age?: string;
    age_unit?: string;
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
};
type Reservation = {
    id: string;
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
    const preview = Boolean(previewData);
    const populate = useCallback((json: SoftOpeningData) => { setData(json); setFirst(json.family?.guardian?.first_name === 'Guardian' ? '' : json.family?.guardian?.first_name ?? ''); setLast(json.family?.guardian?.last_name ?? ''); setChildren(json.family?.children.length ? json.family.children.map(c => ({ ...c, name: [c.first_name, c.last_name].filter(Boolean).join(' '), selected: true })) : [{ new_id: crypto.randomUUID(), name: '', age: '', age_unit: 'years', selected: true }]); const requestedId = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('slot') : null; const requested = json.slots?.find(slot => slot.id === requestedId && !slot.is_closed && !slot.is_full); const firstSlot = requested ?? json.slots?.find(slot => dayKey(slot.starts_at) >= earliestDate); if (firstSlot) { setDate(dayKey(firstSlot.starts_at)); if (requested) setSlotId(requested.id); } }, [earliestDate]);
    useEffect(() => { if (previewData) {
        populate(previewData);
        return;
    } let active = true; fetch(reservationsUrl, { cache: 'no-store' }).then(r => r.json()).then(json => { if (active)
        populate(json); }).catch(() => { if (active)
        setError('Unable to load reservations. Please refresh to try again.'); }); return () => { active = false; }; }, [previewData, reservationsUrl, populate]);
    useEffect(() => { if (preview)
        return; const params = new URLSearchParams(window.location.search); const id = params.get('reservation'); if (params.get('payment') !== 'returned' || !id)
        return; setBusy(true); fetch(`/api/open-play-reservations/${encodeURIComponent(id)}/payment`, { cache: 'no-store' }).then(r => r.json()).then(json => { if (!json.ok)
        throw new Error(json.error); window.location.assign(`/landing/waiver?reservation=${encodeURIComponent(id)}`); }).catch(e => { setError(e.message); setBusy(false); }); }, [preview]);
    const slots = (data?.slots ?? []).filter(s => dayKey(s.starts_at) >= earliestDate && dayKey(s.starts_at) === date);
    const selected = slots.find(s => s.id === slotId) ?? null;
    const participating = children.filter(c => c.selected);
    const pricingChildren = participating.map((child, i) => {
        let birthdate = child.birthdate;
        const age = parseChildAge(child.age, child.age_unit);
        if (!birthdate && age) {
            const born = new Date(); born.setUTCMonth(born.getUTCMonth() - age.months);
            birthdate = born.toISOString().slice(0, 10);
        }
        return { id: child.id ?? `new-${i}`, birthdate };
    });
    const amount = softOpeningAmount(pricingChildren.map(child => child.id), data?.family?.memberships ?? [], date, pricingChildren);
    const reservation = data?.reservations?.find(r => r.status === 'reserved' && r.slot && new Date(r.slot.ends_at) > new Date());
    function patchChild(index: number, patch: Partial<Child>) { setChildren(cs => cs.map((c, i) => i === index ? { ...c, ...patch } : c)); }
    async function pay(id: string) { setBusy(true); setError(''); try {
        const response = await fetch(`/api/open-play-reservations/${id}/payment`, { method: 'POST' });
        const json = await response.json();
        if (!response.ok || !json.ok)
            throw new Error(json.error);
        window.location.assign(json.url ?? `/landing/waiver?reservation=${id}`);
    }
    catch (e) {
        setError(e instanceof Error ? e.message : 'Please try again.');
        setBusy(false);
    } }
    async function reserve(event: React.FormEvent) { event.preventDefault(); if (!selected)
        return; setError(''); if (preview) {
        setSuccess('Preview: your visit is reserved. Next, complete the family waiver.');
        return;
    } setBusy(true); try {
        const response = await fetch('/api/open-play-reservations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ booking_source: publicBooking ? 'public' : 'invitation', slot_id: selected.id, adult_count: Number(adults), guardian_first_name: first, guardian_last_name: last, children: participating.map(c => ({ id: c.id, new_id: c.new_id, name: c.name, age: c.age, age_unit: c.age_unit ?? 'years' })), payment_choice: choice, notes }) });
        const json = await response.json();
        if (!response.ok || !json.ok)
            throw new Error(json.error);
        setData(current => ({ ...current, reservations: [{ ...json.reservation, slot: selected }] }));
        if (choice === 'now' && json.reservation.amount_cents > 0)
            await pay(json.reservation.id);
        else
            window.location.assign(json.waiver_url);
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
  <header className={styles.hero}><div><span className={styles.eyebrow}>Open play reservations</span><h1>Come wander<br />with us.</h1><p>Our doors are opening, and we’d love to welcome your family for a soft opening visit.</p><div className={styles.tags}><span>{publicBooking ? 'Everyone welcome · Visits from November 14' : 'Opening November 11'}</span><span>Nov 14–15: 7 children per arrival window · From Nov 16: 10</span></div></div><div className={styles.photo}><Image src="/play-studio.jpg" alt="The Little Wanderers play studio" fill sizes="(max-width: 700px) 100vw, 430px" priority/><span>Big adventures. Little wanderers.</span></div></header>
  <div className={styles.info}><strong>A little flexibility, a lot of play.</strong><p>Reservations are recommended because capacity is limited. Your hour is an approximate arrival window. Aim to come within it; you don’t need to arrive right on the dot. Once you’re here, stay until you’re ready to leave, up to closing. It’s an arrival window, not a one-hour play limit.</p><p>Soft opening, Nov 11–13: Wanderlist families only, 9am–3pm. Open to everyone from Nov 14: 9am–3pm. From Monday, Nov 16: 9am–6pm. All times Eastern. All hours are subject to scheduled private events; check the calendar for availability.</p></div>
  {error && <p className={styles.error} role="alert">{error}</p>}{success && <p className={styles.success} role="status">{success}</p>}
  {!data && !error ? <p role="status">Loading your family and visit times…</p> : data && !data.ok ? <section className={styles.card}><h2>Come play with us.</h2><p>All families are welcome. Sign in or create your free account to reserve.</p><Link className={styles.primary} href={signInHref}>Sign in / Create account</Link><p>{data.error}</p></section> : reservation ? <section className={styles.card}><span className={styles.eyebrow}>Your visit is reserved</span><h2>{dateLabel(dayKey(reservation.slot!.starts_at))}</h2><p>Approximate arrival: {hour(reservation.slot!.starts_at)}–{hour(reservation.slot!.ends_at)} · {reservation.child_count} child{reservation.child_count === 1 ? '' : 'ren'}</p><p>{reservation.payment_status === 'paid' ? 'Paid online' : reservation.payment_status === 'covered' ? 'Included with your founding membership' : `${money(reservation.amount_cents)} · ${reservation.payment_choice === 'now' ? 'Online payment pending' : 'Pay at the counter'}`}</p><div className={styles.actions}><Link className={styles.primary} href={`/landing/waiver?reservation=${reservation.id}`}>Continue to family waiver →</Link>{reservation.payment_status === 'due' && <button disabled={busy} onClick={() => void pay(reservation.id)}>Pay now</button>}{reservation.payment_choice !== 'now' && reservation.payment_status !== 'paid' && <button disabled={busy} onClick={() => void cancel(reservation.id)}>Cancel reservation</button>}</div>{(reservation.payment_choice === 'now' || reservation.payment_status === 'paid') && <p>Need to change or cancel this visit? <Link href="/landing/contact">Contact us</Link> so we can review your payment.</p>}</section> : data?.ok && <form onSubmit={reserve} className={styles.layout}>
  <div className={styles.steps}>
   <section className={styles.card}><div className={styles.heading}><span>1</span><h2>Your family</h2></div><p>We’ve filled in what we have. Please add any missing names and ages.</p><div className={styles.two}><label>Parent / guardian first name<input autoComplete="given-name" required maxLength={80} value={first} onChange={e => setFirst(e.target.value)}/></label><label>Last name<input autoComplete="family-name" required maxLength={80} value={last} onChange={e => setLast(e.target.value)}/></label></div><h3>Who’s coming to play?</h3><p className={styles.muted}>Choose up to 5 children for this arrival window.</p>{children.map((child, i) => <div className={styles.child} key={child.id ?? `new-${i}`}><label className={styles.check}><input type="checkbox" checked={Boolean(child.selected)} onChange={e => patchChild(i, { selected: e.target.checked })}/>Child {i + 1}</label>{child.selected && <><label>Child’s name<input required maxLength={80} value={child.name ?? ''} onChange={e => patchChild(i, { name: e.target.value })}/></label>{child.birthdate ? <p className={styles.muted}>Age on file ✓</p> : <div className={styles.two}><label>Age<input type="number" required min={0} max={child.age_unit === 'months' ? 144 : 12} step={child.age_unit === 'months' ? 1 : 0.5} value={child.age ?? ''} onChange={e => patchChild(i, { age: e.target.value })}/></label><label>Age unit<select value={child.age_unit ?? 'years'} onChange={e => patchChild(i, { age_unit: e.target.value })}><option value="years">Years</option><option value="months">Months</option></select></label></div>}</>}</div>)}{children.length < 10 && <button disabled={participating.length >= 5} type="button" onClick={() => setChildren(cs => [...cs, { new_id: crypto.randomUUID(), name: '', age: '', age_unit: 'years', selected: true }])}>+ Add a child</button>}<label className={styles.adults}>Adults<select value={adults} onChange={e => setAdults(e.target.value)}><option value="1">1 adult</option><option value="2">2 adults</option></select></label><p className={styles.muted}>Up to 2 accompanying adults included. Please reserve for every child attending.</p></section>
   <section className={styles.card}><div className={styles.heading}><span>2</span><h2>Choose an arrival window</h2></div><label>Visit date<input type="date" min={earliestDate} max="2026-12-31" value={date} onChange={e => { setDate(e.target.value); setSlotId(''); }} required/></label><h3>{dateLabel(date)}</h3><div className={styles.times}>{slots.map(slot => <button type="button" key={slot.id} className={selected?.id === slot.id ? styles.selected : ''} disabled={slot.is_closed || slot.is_full || slot.remaining_children < participating.length} aria-pressed={selected?.id === slot.id} onClick={() => setSlotId(slot.id)}><strong>{hour(slot.starts_at)}–{hour(slot.ends_at)}</strong><small>{slot.is_closed ? 'Closed' : `(${slot.remaining_children}/${slot.capacity_children}) spots left${slot.is_full ? ' · Full' : ''}`}</small></button>)}</div>{!slots.length && <p>No arrival windows available on this date. Please choose another day.</p>}</section>
  </div>
  <aside className={styles.summary}><div className={styles.card}><span className={styles.eyebrow}>Your first little adventure</span><h2>A visit, at your pace.</h2><div className={styles.priceRow}><span>First child / visit</span><strong>$16</strong></div><div className={styles.priceRow}><span>Each additional child (7+ months)</span><strong>$10</strong></div><p className={styles.muted}>Babies 6 months and under: $10 when visiting alone; free with a sibling. Please include every child in your reservation.</p><div className={styles.member}><strong>Founding members play free.</strong><p>Soft opening admission is included for enrolled children. Membership billing starts on your first membership visit.</p><Link href="/landing/membership">Explore founding membership →</Link></div><p>{participating.length} child{participating.length === 1 ? '' : 'ren'} · {adults} adult{adults === '1' ? '' : 's'}</p><p>{selected ? `${dateLabel(date)} · ${hour(selected.starts_at)}–${hour(selected.ends_at)}` : 'Choose your arrival window'}</p><div className={styles.total}><span>Visit total</span><strong>{money(amount)}</strong></div>{amount === 0 && participating.length > 0 ? <p className={styles.muted}>Admission included for your selected children. No admission payment needed.</p> : <fieldset><legend>How would you like to pay?</legend><label className={styles.pay}><input type="radio" name="payment" value="counter" checked={choice === 'counter'} onChange={() => setChoice('counter')}/><span><strong>Pay at the counter</strong><small>Reserve now, pay when you arrive.</small></span></label><label className={styles.pay}><input type="radio" name="payment" value="now" checked={choice === 'now'} onChange={() => setChoice('now')}/><span><strong>Pay now</strong><small>Secure online checkout with Square.</small></span></label></fieldset>}<label>Anything we should know? <span className={styles.muted}>(optional)</span><textarea value={notes} maxLength={500} rows={2} onChange={e => setNotes(e.target.value)}/></label><button className={styles.primary} type="submit" disabled={busy || !selected || participating.length < 1 || participating.length > 5 || Boolean(selected && selected.remaining_children < participating.length)}>{busy ? 'Saving your visit…' : choice === 'now' && amount > 0 ? 'Reserve & pay now →' : 'Reserve my visit →'}</button><p className={styles.next}>Next: complete your family waiver.<br />Everyone needs a signed waiver before entry.</p></div><p className={styles.footer}>We’re finding our rhythm during soft opening. Thank you for your patience, encouragement, and a little extra grace.</p></aside>
  </form>}
 </main>;
}
