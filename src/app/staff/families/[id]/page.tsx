'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import QRCode from 'qrcode';
import AvailabilityCalendar, { type CalendarSlot } from '@/components/calendar/AvailabilityCalendar';

type Person = { id: string; first_name: string | null; last_name: string | null; birthdate?: string | null; role: 'adult' | 'child' | null };
type FamilyDetail = {
  household: { id: string; name: string | null; phone: string | null };
  guardians: Person[];
  children: Person[];
  membership_status: string;
  waiver_status: string;
  waiver?: {
    status: string;
    signed_at: string | null;
    expires_at: string | null;
    days_until_expiration: number | null;
  };
  qr_status: string;
  upcoming_classes: Array<{ id: string; person_id: string; person_name: string; class: { id?: string; title: string; start_time: string } | null }>;
  upcoming_parties: Array<{ id: string; start_time: string; end_time: string; status: string }>;
  visit_history: Array<{ id: string; person_id: string; person_name: string; checked_in_at: string }>;
};

type MemberForm = { id?: string; first_name: string; last_name: string; birthdate: string; role: 'adult' | 'child' };

function waiverLabel(status: string) {
  if (status === 'completed') return 'Waiver completed';
  if (status === 'expired') return 'Waiver expired / renewal needed';
  return 'Waiver required';
}

function toIsoLocal(date: string, hourLocal: number) {
  return new Date(`${date}T${String(hourLocal).padStart(2, '0')}:00:00`).toISOString();
}

export default function StaffFamilyDetailPage({ params }: { params: { id: string } }) {
  const familyId = params.id;
  const searchParams = useSearchParams();
  const router = useRouter();
  const [item, setItem] = useState<FamilyDetail | null>(null);
  const [classes, setClasses] = useState<Array<{ id: string; title: string; start_time: string; price_cents: number }>>([]);
  const [selectedPersonId, setSelectedPersonId] = useState('');
  const [selectedClassId, setSelectedClassId] = useState('');
  const [classCart, setClassCart] = useState<Array<{ class_id: string; quantity: number }>>([]);
  const [partyForm, setPartyForm] = useState({ party_date: new Date().toISOString().slice(0, 10), slot: '11:00', headcount_expected: '', notes: '' });
  const [bookedSlots, setBookedSlots] = useState<Array<{ id: string; start_time: string; end_time: string }>>([]);
  const [editableMembers, setEditableMembers] = useState<MemberForm[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [qrMap, setQrMap] = useState<Record<string, string>>({});
  const [showWaiverPanel, setShowWaiverPanel] = useState(false);

  const load = useCallback(async () => {
    const [detailRes, classesRes, calendarRes] = await Promise.all([
      fetch(`/api/admin/families/${familyId}`, { cache: 'no-store' }),
      fetch('/api/classes?limit=200', { cache: 'no-store' }),
      fetch('/api/party-bookings/calendar', { cache: 'no-store' }),
    ]);

    const detailJson = await detailRes.json();
    const classJson = await classesRes.json();
    const calendarJson = await calendarRes.json();

    setItem(detailJson.item ?? null);
    setClasses(classJson.items ?? []);
    setBookedSlots(calendarJson.items ?? []);
  }, [familyId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!item) return;
    const members = [...item.guardians, ...item.children].map((person) => ({
      id: person.id,
      first_name: person.first_name ?? '',
      last_name: person.last_name ?? '',
      birthdate: person.birthdate ?? '',
      role: (person.role === 'child' ? 'child' : 'adult') as 'adult' | 'child',
    }));
    setEditableMembers(members);
  }, [item]);

  useEffect(() => {
    if (!item) return;
    const run = async () => {
      const map: Record<string, string> = {};
      for (const p of [...item.guardians, ...item.children]) {
        map[p.id] = await QRCode.toDataURL(`lw://person/${p.id}`, { width: 180, margin: 1 });
      }
      setQrMap(map);
    };
    void run();
  }, [item]);

  useEffect(() => {
    const checkout = searchParams.get('class_checkout');
    const personId = searchParams.get('person_id');
    const items = searchParams.get('items');
    if (checkout !== 'success' || !personId || !items) return;

    const parsed = items
      .split(',')
      .map((token) => token.trim())
      .filter(Boolean)
      .map((token) => {
        const [class_id, qtyRaw] = token.split(':');
        return { class_id, quantity: Math.max(1, Number(qtyRaw || 1)) };
      });

    const finalize = async () => {
      const res = await fetch(`/api/admin/families/${familyId}/classes/checkout`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'finalize', person_id: personId, items: parsed }),
      });
      const json = await res.json();
      if (json.ok) {
        setClassCart([]);
        setMessage('Class checkout finalized and registrations created.');
        await load();
      }
      window.history.replaceState({}, '', `/staff/families/${familyId}`);
    };

    void finalize();
  }, [familyId, load, searchParams]);

  const memberOptions = useMemo(() => ([...(item?.guardians ?? []), ...(item?.children ?? [])]), [item]);
  const classById = useMemo(() => new Map(classes.map((klass) => [klass.id, klass])), [classes]);

  const addMemberRow = () => {
    setEditableMembers((prev) => [...prev, { first_name: '', last_name: '', birthdate: '', role: 'child' }]);
  };

  const saveMembers = async () => {
    const res = await fetch(`/api/admin/families/${familyId}/members`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ members: editableMembers }),
    });
    const json = await res.json();
    setMessage(json.ok ? 'Family members saved.' : json.error ?? 'Failed to save family members.');
    await load();
  };

  const addClassToCart = () => {
    if (!selectedClassId) return;
    setClassCart((prev) => {
      const existing = prev.find((entry) => entry.class_id === selectedClassId);
      if (existing) return prev.map((entry) => (entry.class_id === selectedClassId ? { ...entry, quantity: entry.quantity + 1 } : entry));
      return [...prev, { class_id: selectedClassId, quantity: 1 }];
    });
  };

  const checkoutClasses = async () => {
    if (!selectedPersonId || classCart.length === 0) return;
    const res = await fetch(`/api/admin/families/${familyId}/classes/checkout`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'create_payment_link', person_id: selectedPersonId, items: classCart }),
    });
    const json = await res.json();
    if (!res.ok || !json.ok) {
      setMessage(json.error ?? 'Could not start class checkout.');
      return;
    }
    window.location.assign(json.payment_url);
  };

  const submitParty = async () => {
    const startIso = toIsoLocal(partyForm.party_date, partyForm.slot === '15:00' ? 15 : 11);
    const endIso = toIsoLocal(partyForm.party_date, partyForm.slot === '15:00' ? 18 : 14);

    const res = await fetch(`/api/admin/families/${familyId}/party-bookings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        start_time: startIso,
        end_time: endIso,
        headcount_expected: partyForm.headcount_expected ? Number(partyForm.headcount_expected) : null,
        notes: partyForm.notes || null,
      }),
    });

    const json = await res.json();
    setMessage(json.ok ? 'Party booking created.' : json.error ?? 'Party booking failed.');
    await load();
  };

  const partySlots: CalendarSlot[] = [
    ...(() => {
      const generated: CalendarSlot[] = [];
      const now = new Date();
      const blockedStarts = new Set(
        [...bookedSlots, ...(item?.upcoming_parties ?? [])].map((slot) => new Date(slot.start_time).getTime())
      );

      for (let i = 0; i < 84; i += 1) {
        const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + i));
        const day = d.getUTCDay();
        if (day !== 0 && day !== 6) continue;
        const dayStr = d.toISOString().slice(0, 10);
        const start11 = toIsoLocal(dayStr, 11);
        const start15 = toIsoLocal(dayStr, 15);
        if (!blockedStarts.has(new Date(start11).getTime())) {
          generated.push({ id: `avail-${dayStr}-11`, start: start11, end: toIsoLocal(dayStr, 14), label: 'Available party slot', status: 'available' });
        }
        if (!blockedStarts.has(new Date(start15).getTime())) {
          generated.push({ id: `avail-${dayStr}-15`, start: start15, end: toIsoLocal(dayStr, 18), label: 'Available party slot', status: 'available' });
        }
      }
      return generated;
    })(),
    ...bookedSlots.map((slot) => ({ id: `booked-${slot.id}`, start: slot.start_time, end: slot.end_time, label: 'Reserved slot', status: 'booked' as const })),
    ...(item?.upcoming_parties ?? []).map((party) => ({ id: `mine-${party.id}`, start: party.start_time, end: party.end_time, label: 'This family party', status: 'mine' as const })),
  ];

  if (!item) return <main style={{ padding: 24 }}>Loading family…</main>;
  const waiver = item.waiver ?? { status: item.waiver_status, signed_at: null, expires_at: null, days_until_expiration: null };
  const waiverUrl = process.env.NEXT_PUBLIC_WAIVER_URL ?? 'https://docs.google.com/forms/d/e/1FAIpQLSeleoqMn8UslZs8RiEg_02Ld4t-5WuIyhhHySoyb_3mCYJMUw/viewform?usp=dialog';

  return (
    <main style={{ padding: 24, maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <p style={{ margin: 0 }}><Link href="/staff/families">← Back to Family Management</Link></p>
        <p style={{ margin: 0 }}><Link href="/staff">← Back to Staff Dashboard</Link></p>
      </div>
      <h1 style={{ color: '#4f3f82' }}>{item.household.name ?? 'Family detail'}</h1>
      <p style={{ color: '#6d6480' }}>Membership: {item.membership_status} · Waiver: {waiverLabel(item.waiver_status)} · QR: {item.qr_status}</p>
      {message && <p style={{ color: '#5f3da4' }}>{message}</p>}

      <section style={{ border: '1px solid #eadfff', borderRadius: 16, padding: 14, background: '#fff' }}>
        <h3 style={{ marginTop: 0 }}>Edit / Add family members</h3>
        <div style={{ display: 'grid', gap: 8 }}>
          {editableMembers.map((member, idx) => (
            <div key={`${member.id ?? 'new'}-${idx}`} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 120px', gap: 8 }}>
              <input value={member.first_name} placeholder="First name" onChange={(e) => setEditableMembers((prev) => prev.map((m, i) => (i === idx ? { ...m, first_name: e.target.value } : m)))} />
              <input value={member.last_name} placeholder="Last name" onChange={(e) => setEditableMembers((prev) => prev.map((m, i) => (i === idx ? { ...m, last_name: e.target.value } : m)))} />
              <input type="date" value={member.birthdate} onChange={(e) => setEditableMembers((prev) => prev.map((m, i) => (i === idx ? { ...m, birthdate: e.target.value } : m)))} />
              <select value={member.role} onChange={(e) => setEditableMembers((prev) => prev.map((m, i) => (i === idx ? { ...m, role: e.target.value as 'adult' | 'child' } : m)))}>
                <option value="adult">Adult</option>
                <option value="child">Child</option>
              </select>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
          <button type="button" onClick={addMemberRow}>Add member</button>
          <button type="button" onClick={saveMembers}>Save family</button>
          <button type="button" onClick={() => setShowWaiverPanel((prev) => !prev)}>
            {showWaiverPanel ? 'Hide waiver details' : 'Manage waiver'}
          </button>
          <button type="button" onClick={() => router.push(`/staff/families/${familyId}/membership`)}>Manage membership</button>
        </div>
        {showWaiverPanel && (
          <div style={{ marginTop: 12, border: '1px solid #efe6ff', borderRadius: 12, padding: 10, background: '#faf7ff' }}>
            <p style={{ margin: '0 0 8px', color: '#4f3f82', fontWeight: 700 }}>Waiver status: {waiverLabel(waiver.status)}</p>
            {waiver.signed_at && <p style={{ margin: '4px 0', color: '#5f5470' }}>Signed: {new Date(waiver.signed_at).toLocaleDateString()}</p>}
            {waiver.expires_at && <p style={{ margin: '4px 0', color: '#5f5470' }}>Expires: {new Date(waiver.expires_at).toLocaleDateString()}</p>}
            {waiver.status === 'completed' && waiver.days_until_expiration !== null && (
              <p style={{ margin: '4px 0', color: '#137333' }}>
                {waiver.days_until_expiration >= 0
                  ? `${waiver.days_until_expiration} day${waiver.days_until_expiration === 1 ? '' : 's'} left until renewal is needed.`
                  : 'Renewal needed now.'}
              </p>
            )}
            {(waiver.status === 'required' || waiver.status === 'expired') && (
              <p style={{ margin: '6px 0 0', color: '#9a3412' }}>
                A valid waiver is needed.{' '}
                <a href={waiverUrl} target="_blank" rel="noreferrer">Open waiver form</a>
              </p>
            )}
          </div>
        )}
      </section>

      <section style={{ marginTop: 16, border: '1px solid #eadfff', borderRadius: 16, padding: 14, background: '#fff' }}>
        <h3 style={{ marginTop: 0 }}>Generate / View QR</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 10 }}>
          {[...item.guardians, ...item.children].map((person) => (
            <div key={person.id} style={{ border: '1px solid #eee', borderRadius: 10, padding: 8 }}>
              <p style={{ margin: 0 }}>{person.first_name} {person.last_name ?? ''} ({person.role ?? 'member'})</p>
              {qrMap[person.id] ? <Image src={qrMap[person.id]} alt={`QR for ${person.first_name ?? 'member'}`} width={150} height={150} /> : <p>Generating...</p>}
            </div>
          ))}
        </div>
      </section>

      <section style={{ marginTop: 16, border: '1px solid #eadfff', borderRadius: 16, padding: 14, background: '#fff' }}>
        <h3 style={{ marginTop: 0 }}>Owner actions</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 10, alignItems: 'center' }}>
          <select value={selectedPersonId} onChange={(e) => setSelectedPersonId(e.target.value)}>
            <option value="">Select member for class registration</option>
            {memberOptions.map((person) => (
              <option key={person.id} value={person.id}>{person.first_name} {person.last_name ?? ''} ({person.role ?? 'member'})</option>
            ))}
          </select>
          <select value={selectedClassId} onChange={(e) => setSelectedClassId(e.target.value)}>
            <option value="">Select class</option>
            {classes.map((klass) => (
              <option key={klass.id} value={klass.id}>{klass.title} ({new Date(klass.start_time).toLocaleString()})</option>
            ))}
          </select>
          <button type="button" onClick={addClassToCart}>Register for class (add to cart)</button>
        </div>

        <div style={{ marginTop: 12 }}>
          <h4 style={{ marginBottom: 6 }}>Class cart</h4>
          {classCart.length === 0 ? <p style={{ margin: 0 }}>Cart is empty.</p> : classCart.map((entry) => (
            <div key={entry.class_id} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span>{classById.get(entry.class_id)?.title ?? entry.class_id} × {entry.quantity}</span>
              <button type="button" onClick={() => setClassCart((prev) => prev.filter((i) => i.class_id !== entry.class_id))}>Remove</button>
            </div>
          ))}
          <button type="button" onClick={checkoutClasses} disabled={!selectedPersonId || classCart.length === 0}>Checkout class cart</button>
        </div>

        <div style={{ marginTop: 18 }}>
          <h4 style={{ marginBottom: 6 }}>Book party</h4>
          <AvailabilityCalendar title="Party calendar" slots={partySlots} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
            <input type="date" value={partyForm.party_date} onChange={(e) => setPartyForm((prev) => ({ ...prev, party_date: e.target.value }))} />
            <select value={partyForm.slot} onChange={(e) => setPartyForm((prev) => ({ ...prev, slot: e.target.value }))}>
              <option value="11:00">11:00 AM - 2:00 PM</option>
              <option value="15:00">3:00 PM - 6:00 PM</option>
            </select>
            <input type="number" min={0} value={partyForm.headcount_expected} placeholder="Headcount" onChange={(e) => setPartyForm((prev) => ({ ...prev, headcount_expected: e.target.value }))} />
            <input value={partyForm.notes} placeholder="Notes" onChange={(e) => setPartyForm((prev) => ({ ...prev, notes: e.target.value }))} />
          </div>
          <button style={{ marginTop: 8 }} type="button" onClick={submitParty}>Book party</button>
        </div>
      </section>

      <section style={{ marginTop: 16 }}>
        <h3>Upcoming classes</h3>
        {item.upcoming_classes.length === 0 ? <p>-</p> : item.upcoming_classes.map((c) => <p key={c.id}>{c.person_name}: {c.class?.title} ({c.class?.start_time ? new Date(c.class.start_time).toLocaleString() : '-'})</p>)}

        <h3>Upcoming parties</h3>
        {item.upcoming_parties.length === 0 ? <p>-</p> : item.upcoming_parties.map((p) => <p key={p.id}>{new Date(p.start_time).toLocaleString()} - {p.status}</p>)}

        <h3>Visit history</h3>
        {item.visit_history.length === 0 ? <p>-</p> : item.visit_history.map((v) => <p key={v.id}>{v.person_name}: {new Date(v.checked_in_at).toLocaleString()}</p>)}
      </section>
    </main>
  );
}
