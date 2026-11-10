'use client';
import { useCallback, useEffect, useState } from 'react';
import { softOpeningAmount } from '@/lib/soft-opening-pricing';
type Slot = { id: string; starts_at: string; ends_at: string; remaining_children: number; remaining_total: number | null };
type Data = { family: { children: { id: string; first_name: string; last_name: string | null }[]; memberships: Parameters<typeof softOpeningAmount>[1] }; slots: Slot[]; reservations: { id: string; status: string; child_count: number; adult_count: number; amount_cents: number; payment_status: string; slot: Slot }[] };
const day = (s: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(s));
const time = (s: string) => new Date(s).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
export default function FamilyOpenPlayBooking({ familyId, canManage }: { familyId: string; canManage: boolean }) {
  const [data, setData] = useState<Data | null>(null), [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
  const [date, setDate] = useState(''), [slot, setSlot] = useState(''), [children, setChildren] = useState<string[]>([]), [adults, setAdults] = useState(1), [notes, setNotes] = useState('');
  const load = useCallback(async () => {
    const response = await fetch(`/api/admin/families/${familyId}/open-play-reservations`, { cache: 'no-store' });
    const json = await response.json(); if (!response.ok || !json.ok) throw new Error(json.error || 'Unable to load reservations.');
    setData(json); setDate(d => d || (json.slots[0] ? day(json.slots[0].starts_at) : '')); setChildren(c => c.length ? c : json.family.children.slice(0, 5).map((p: { id: string }) => p.id));
  }, [familyId]);
  useEffect(() => { void load().catch(e => setMessage(e.message)); }, [load]);
  async function reserve(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setMessage('');
    try {
      const response = await fetch(`/api/admin/families/${familyId}/open-play-reservations`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slot_id: slot, child_ids: children, adult_count: adults, notes }) });
      const json = await response.json(); if (!response.ok || !json.ok) throw new Error(json.error || 'Unable to save reservation.');
      setMessage('Open Play visit reserved. No payment was taken.'); setSlot(''); await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Please try again.'); } finally { setBusy(false); }
  }
  return <section style={{ marginTop: 20, padding: 20, border: '1px solid #eadfff', borderRadius: 16, background: '#fff' }} aria-label="Family Open Play reservations"><h2>Open Play reservations</h2>
    {message && <p role="status">{message}</p>}
    {!data ? <p>Loading Open Play visits…</p> : <><ul>{data.reservations.map(r => <li key={r.id}>{r.slot ? `${day(r.slot.starts_at)} · ${time(r.slot.starts_at)}–${time(r.slot.ends_at)} Eastern` : 'Visit'} · {r.child_count} children / {r.adult_count} adults · {r.status.replace('_', ' ')} · {r.payment_status === 'covered' ? 'Included with membership' : r.payment_status === 'paid' ? 'Paid' : `$${(r.amount_cents / 100).toFixed(2)} at counter`}</li>)}</ul>{!data.reservations.length && <p>No Open Play reservations yet.</p>}
    {canManage && <form onSubmit={reserve}><h3>Reserve an Open Play visit</h3><fieldset disabled={busy} style={{ display: 'grid', gap: 12, border: 0, padding: 0 }}><label>Visit date <input type="date" min={day(new Date().toISOString())} max="2026-12-31" required value={date} onChange={e => { setDate(e.target.value); setSlot(''); }} /></label><label>Arrival window (Eastern) <select required value={slot} onChange={e => setSlot(e.target.value)}><option value="">Choose an arrival window</option>{data.slots.filter(s => day(s.starts_at) === date).map(s => <option key={s.id} value={s.id} disabled={s.remaining_children < children.length || (s.remaining_total != null && s.remaining_total < children.length + adults)}>{time(s.starts_at)}–{time(s.ends_at)} · {s.remaining_children} child spots</option>)}</select></label><div>{data.family.children.map(p => <label key={p.id} style={{ display: 'block' }}><input type="checkbox" checked={children.includes(p.id)} onChange={e => setChildren(ids => e.target.checked ? [...ids, p.id] : ids.filter(id => id !== p.id))} /> {p.first_name} {p.last_name}</label>)}</div><label>Adults <select value={adults} onChange={e => setAdults(Number(e.target.value))}><option value={1}>1 adult</option><option value={2}>2 adults</option></select></label><label>Notes <input maxLength={500} value={notes} onChange={e => setNotes(e.target.value)} /></label><p>Admission: <strong>${(softOpeningAmount(children, data.family.memberships, date) / 100).toFixed(2)}</strong> · Membership applies to enrolled children; other admission is paid at the counter. The family waiver is required before check-in.</p><button disabled={!slot || !children.length || children.length > 5} type="submit">Reserve Open Play visit</button></fieldset></form>}</>}
  </section>;
}
