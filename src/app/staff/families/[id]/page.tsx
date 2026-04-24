'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';

type Person = { id: string; first_name: string | null; last_name: string | null; role: 'adult' | 'child' | null };
type FamilyDetail = {
  household: { id: string; name: string | null; phone: string | null };
  guardians: Person[];
  children: Person[];
  membership_status: string;
  waiver_status: string;
  qr_status: string;
  upcoming_classes: Array<{ id: string; person_id: string; person_name: string; class: { title: string; start_time: string } | null }>;
  upcoming_parties: Array<{ id: string; start_time: string; end_time: string; status: string }>;
  visit_history: Array<{ id: string; person_id: string; person_name: string; checked_in_at: string }>;
};

export default function StaffFamilyDetailPage({ params }: { params: { id: string } }) {
  const familyId = params.id;
  const [item, setItem] = useState<FamilyDetail | null>(null);
  const [classes, setClasses] = useState<Array<{ id: string; title: string; start_time: string }>>([]);
  const [selectedPersonId, setSelectedPersonId] = useState('');
  const [selectedClassId, setSelectedClassId] = useState('');
  const [partyDateTime, setPartyDateTime] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!familyId) return;
    const [detailRes, classesRes] = await Promise.all([
      fetch(`/api/admin/families/${familyId}`, { cache: 'no-store' }),
      fetch('/api/classes?limit=200', { cache: 'no-store' }),
    ]);

    const detailJson = await detailRes.json();
    const classJson = await classesRes.json();
    setItem(detailJson.item ?? null);
    setClasses(classJson.items ?? []);
  }, [familyId]);

  useEffect(() => {
    void load();
  }, [load]);

  const memberOptions = useMemo(() => ([...(item?.guardians ?? []), ...(item?.children ?? [])]), [item]);

  const registerClass = async () => {
    if (!familyId || !selectedPersonId || !selectedClassId) return;
    const res = await fetch(`/api/admin/families/${familyId}/class-registrations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ class_id: selectedClassId, person_id: selectedPersonId }),
    });
    const json = await res.json();
    setMessage(json.ok ? 'Class registration completed.' : json.error ?? 'Failed to register class.');
    await load();
  };

  const bookParty = async () => {
    if (!familyId || !partyDateTime) return;
    const start = new Date(partyDateTime);
    const end = new Date(start);
    end.setHours(end.getHours() + 3);

    const res = await fetch(`/api/admin/families/${familyId}/party-bookings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ start_time: start.toISOString(), end_time: end.toISOString(), notes: 'Staff booking' }),
    });
    const json = await res.json();
    setMessage(json.ok ? 'Party booking created.' : json.error ?? 'Failed to book party.');
    await load();
  };

  const checkinNow = async () => {
    if (!familyId || !selectedPersonId) return;
    const res = await fetch(`/api/admin/families/${familyId}/checkin`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ person_id: selectedPersonId }),
    });
    const json = await res.json();
    setMessage(json.ok ? 'Checked in successfully.' : json.error ?? 'Check-in failed.');
    await load();
  };

  if (!item) return <main style={{ padding: 24 }}>Loading family…</main>;

  return (
    <main style={{ padding: 24, maxWidth: 1100, margin: '0 auto' }}>
      <p style={{ margin: 0 }}><Link href="/staff/families">← Back to Family Management</Link></p>
      <h1 style={{ color: '#4f3f82' }}>{item.household.name ?? 'Family detail'}</h1>
      <p style={{ color: '#6d6480' }}>Membership: {item.membership_status} · Waiver: {item.waiver_status} · QR: {item.qr_status}</p>
      {message && <p style={{ color: '#5f3da4' }}>{message}</p>}

      <section style={{ border: '1px solid #eadfff', borderRadius: 16, padding: 14, background: '#fff' }}>
        <h3 style={{ marginTop: 0 }}>Guardian info</h3>
        <p>{item.guardians.map((p) => `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim()).join(', ') || '-'}</p>
        <h3>Children</h3>
        <p>{item.children.map((p) => `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim()).join(', ') || '-'}</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <button type="button">Edit family</button>
          <button type="button">Add member</button>
          <button type="button">Generate / View QR</button>
          <button type="button">Manage waiver</button>
          <button type="button">Manage membership</button>
        </div>
      </section>

      <section style={{ marginTop: 16, border: '1px solid #eadfff', borderRadius: 16, padding: 14, background: '#fff' }}>
        <h3 style={{ marginTop: 0 }}>Owner actions</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <select value={selectedPersonId} onChange={(e) => setSelectedPersonId(e.target.value)}>
            <option value="">Select member</option>
            {memberOptions.map((person) => (
              <option key={person.id} value={person.id}>{person.first_name} {person.last_name ?? ''} ({person.role ?? 'member'})</option>
            ))}
          </select>
          <button onClick={checkinNow}>Check in now</button>

          <select value={selectedClassId} onChange={(e) => setSelectedClassId(e.target.value)}>
            <option value="">Select class</option>
            {classes.map((klass) => (
              <option key={klass.id} value={klass.id}>{klass.title} ({new Date(klass.start_time).toLocaleString()})</option>
            ))}
          </select>
          <button onClick={registerClass}>Register for class</button>

          <input type="datetime-local" value={partyDateTime} onChange={(e) => setPartyDateTime(e.target.value)} />
          <button onClick={bookParty}>Book party</button>
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
