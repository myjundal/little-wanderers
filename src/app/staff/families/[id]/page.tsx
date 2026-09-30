'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import QRCode from 'qrcode';
import AvailabilityCalendar, { type CalendarSlot } from '@/components/calendar/AvailabilityCalendar';
import StaffToolNav from '@/components/staff/StaffToolNav';
import {
  getDefaultPartyBookingSlot,
  getPartyBookingSlotOptionsForDate,
  getPartyBookingStartDate,
  isVisiblePartyCalendarSlot,
  PARTY_BOOKING_START_DATE,
  PARTY_BOOKING_SLOTS,
  type PartyBookingSlot,
} from '@/lib/party-config';

type Person = { id: string; first_name: string | null; last_name: string | null; gender?: string | null; birthdate?: string | null; role: 'adult' | 'child' | null };
type FamilyDetail = {
  household: { id: string; name: string | null; phone: string | null; email?: string | null; city?: string | null; state?: string | null };
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
type StaffClass = {
  id: string;
  title: string;
  category: string | null;
  start_time: string;
  end_time: string;
  duration_minutes: number | null;
  instructor_name: string | null;
  description: string | null;
  age_range: string | null;
  caregiver_participation: string | null;
  schedule_note: string | null;
  schedule_label: string | null;
  capacity: number | null;
  price_cents: number;
  booked_count: number;
  seats_left: number | null;
  waitlist_offer_pending?: boolean;
  waitlist_count?: number;
};

const PARTY_SLOT_LOOKAHEAD_DAYS = 370;
const CLASS_TIME_ZONE = 'America/New_York';

function emptyPartyForm() {
  const partyDate = getPartyBookingStartDate().toISOString().slice(0, 10);
  return {
    party_date: partyDate,
    slot: getDefaultPartyBookingSlot(partyDate),
    headcount_expected: '',
    birthday_child_name: '',
    birthday_age: '',
    notes: '',
  };
}

function waiverLabel(status: string) {
  if (status === 'completed') return 'Waiver completed';
  if (status === 'expired') return 'Waiver expired / renewal needed';
  return 'Waiver required';
}

function toIsoLocal(date: string, hourLocal: number) {
  return new Date(`${date}T${String(hourLocal).padStart(2, '0')}:00:00`).toISOString();
}

function formatClassTimeRange(startIso: string, endIso: string) {
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 'Time TBA';
  const day = start.toLocaleDateString('en-US', { timeZone: CLASS_TIME_ZONE, weekday: 'short', month: 'short', day: 'numeric' });
  const startTime = start.toLocaleTimeString('en-US', { timeZone: CLASS_TIME_ZONE, hour: 'numeric', minute: '2-digit' }).toLowerCase();
  const endTime = end.toLocaleTimeString('en-US', { timeZone: CLASS_TIME_ZONE, hour: 'numeric', minute: '2-digit' }).toLowerCase();
  return `${day}, ${startTime}-${endTime}`;
}

function formatClassPrice(priceCents: number) {
  if (priceCents <= 0) return 'Free';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: priceCents % 100 === 0 ? 0 : 2,
  }).format(priceCents / 100);
}

function classSeatsLabel(klass: StaffClass) {
  if (klass.capacity == null) return 'Open';
  if (klass.waitlist_offer_pending || (klass.waitlist_count ?? 0) > 0) return 'Waitlist open';
  const seatsLeft = klass.seats_left ?? Math.max(klass.capacity - klass.booked_count, 0);
  if (seatsLeft <= 0) return 'Waitlist';
  return `${seatsLeft}/${klass.capacity} seats left`;
}

function getPartyBlackoutSlots(): CalendarSlot[] {
  const start = getPartyBookingStartDate();
  const monthStart = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  const slots: CalendarSlot[] = [];

  for (let d = new Date(monthStart); d.getTime() < start.getTime(); d.setUTCDate(d.getUTCDate() + 1)) {
    const day = d.getUTCDay();
    if (day !== 5 && day !== 6 && day !== 0) continue;
    const dayStr = d.toISOString().slice(0, 10);
    slots.push({
      id: `blackout-${dayStr}`,
      start: toIsoLocal(dayStr, 10),
      end: toIsoLocal(dayStr, 18),
      label: 'Unavailable before opening',
      status: 'full',
    });
  }

  return slots;
}

export default function StaffFamilyDetailPage({ params }: { params: { id: string } }) {
  const familyId = params.id;
  const router = useRouter();
  const [item, setItem] = useState<FamilyDetail | null>(null);
  const [classes, setClasses] = useState<StaffClass[]>([]);
  const [selectedPersonId, setSelectedPersonId] = useState('');
  const [selectedClassId, setSelectedClassId] = useState('');
  const [registeringClassId, setRegisteringClassId] = useState<string | null>(null);
  const [partyForm, setPartyForm] = useState(emptyPartyForm);
  const [bookedSlots, setBookedSlots] = useState<Array<{ id: string; start_time: string; end_time: string }>>([]);
  const [editableMembers, setEditableMembers] = useState<MemberForm[]>([]);
  const [familyLocation, setFamilyLocation] = useState({ city: '', state: 'CT' });
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
    setFamilyLocation({ city: item.household.city ?? '', state: item.household.state ?? 'CT' });
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

  const memberOptions = useMemo(() => ([...(item?.guardians ?? []), ...(item?.children ?? [])]), [item]);
  const classRegistrationOptions = useMemo(() => (item?.children.length ? item.children : memberOptions), [item?.children, memberOptions]);

  const addMemberRow = () => {
    setEditableMembers((prev) => [...prev, { first_name: '', last_name: '', birthdate: '', role: 'child' }]);
  };

  const saveFamily = async (successMessage = 'Family saved.') => {
    const res = await fetch(`/api/admin/families/${familyId}/members`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ members: editableMembers, city: familyLocation.city, state: familyLocation.state }),
    });
    const json = await res.json();
    setMessage(json.ok ? successMessage : json.error ?? 'Failed to save family.');
    await load();
  };

  const registerClass = async (classId = selectedClassId) => {
    if (!selectedPersonId || !classId) return;
    setRegisteringClassId(classId);
    const res = await fetch(`/api/admin/families/${familyId}/classes/checkout`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'register', person_id: selectedPersonId, items: [{ class_id: classId, quantity: 1 }] }),
    });
    const json = await res.json();
    setRegisteringClassId(null);
    if (!res.ok || !json.ok) {
      setMessage(json.error ?? 'Could not register for class.');
      return;
    }
    setSelectedClassId(classId);
    setMessage(json.status === 'waitlist' ? 'Added to the class waitlist.' : 'Class registration saved.');
    await load();
  };

  const submitParty = async () => {
    const slotOption = PARTY_BOOKING_SLOTS.find((slot) => slot.value === partyForm.slot);
    if (!slotOption || !getPartyBookingSlotOptionsForDate(partyForm.party_date).some((slot) => slot.value === partyForm.slot)) {
      setMessage('Choose an available Friday afternoon, Saturday, or Sunday party slot.');
      return;
    }
    const startIso = toIsoLocal(partyForm.party_date, slotOption.startHour);
    const endIso = toIsoLocal(partyForm.party_date, slotOption.endHour);
    const birthdayAge = partyForm.birthday_age.trim() ? Number(partyForm.birthday_age) : null;
    if (birthdayAge != null && (!Number.isInteger(birthdayAge) || birthdayAge <= 0 || birthdayAge > 21)) {
      setMessage('Birthday age should be a whole number between 1 and 21.');
      return;
    }

    const res = await fetch(`/api/admin/families/${familyId}/party-bookings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        start_time: startIso,
        end_time: endIso,
        headcount_expected: partyForm.headcount_expected ? Number(partyForm.headcount_expected) : null,
        birthday_child_name: partyForm.birthday_child_name.trim() || null,
        birthday_age: birthdayAge,
        notes: partyForm.notes || null,
      }),
    });

    const json = await res.json();
    setMessage(json.ok ? 'Party booking created.' : json.error ?? 'Party booking failed.');
    if (json.ok) {
      setPartyForm(emptyPartyForm());
    }
    await load();
  };

  const partySlots: CalendarSlot[] = [
    ...getPartyBlackoutSlots(),
    ...(() => {
      const generated: CalendarSlot[] = [];
      const now = getPartyBookingStartDate();
      const blockedStarts = new Set(
        [...bookedSlots, ...(item?.upcoming_parties ?? [])].map((slot) => new Date(slot.start_time).getTime())
      );

      for (let i = 0; i < PARTY_SLOT_LOOKAHEAD_DAYS; i += 1) {
        const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + i));
        const day = d.getUTCDay();
        if (day !== 5 && day !== 6 && day !== 0) continue;
        const dayStr = d.toISOString().slice(0, 10);
        for (const slot of getPartyBookingSlotOptionsForDate(dayStr)) {
          const start = toIsoLocal(dayStr, slot.startHour);
          if (blockedStarts.has(new Date(start).getTime())) continue;
          generated.push({ id: `avail-${dayStr}-${slot.value}`, start, end: toIsoLocal(dayStr, slot.endHour), label: 'Available party slot', status: 'available' });
        }
      }
      return generated;
    })(),
    ...bookedSlots.map((slot) => ({ id: `booked-${slot.id}`, start: slot.start_time, end: slot.end_time, label: 'Reserved slot', status: 'booked' as const })),
    ...(item?.upcoming_parties ?? [])
      .filter((party) => isVisiblePartyCalendarSlot(party.start_time))
      .map((party) => ({ id: `mine-${party.id}`, start: party.start_time, end: party.end_time, label: 'This family party', status: 'mine' as const })),
  ];

  if (!item) return <main style={{ padding: 24 }}>Loading family…</main>;
  const partySlotOptions = getPartyBookingSlotOptionsForDate(partyForm.party_date);
  const waiver = item.waiver ?? { status: item.waiver_status, signed_at: null, expires_at: null, days_until_expiration: null };
  const waiverUrl = process.env.NEXT_PUBLIC_WAIVER_URL ?? 'https://docs.google.com/forms/d/e/1FAIpQLSeleoqMn8UslZs8RiEg_02Ld4t-5WuIyhhHySoyb_3mCYJMUw/viewform?usp=dialog';

  return (
    <main style={{ padding: '16px clamp(12px, 4vw, 24px)', maxWidth: 1100, margin: '0 auto', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <StaffToolNav active="families" />
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <p style={{ margin: 0 }}><Link href="/staff/families">← Back to Family Management</Link></p>
        <p style={{ margin: 0 }}><Link href="/staff">← Back to Owner/Staff Tool</Link></p>
        </div>
      </div>
      <h1 style={{ color: '#4f3f82' }}>{item.household.name ?? 'Family detail'}</h1>
      <p style={{ color: '#6d6480' }}>Membership: {item.membership_status} · Waiver: {waiverLabel(item.waiver_status)} · QR: {item.qr_status}</p>
      {message && <p style={{ color: '#5f3da4' }}>{message}</p>}

      <section style={{ border: '1px solid #eadfff', borderRadius: 16, padding: 14, background: '#fff' }}>
        <h3 style={{ marginTop: 0 }}>Family location</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8, marginBottom: 10 }}>
          <input value={familyLocation.city} placeholder="City" onChange={(e) => setFamilyLocation((p) => ({ ...p, city: e.target.value }))} />
          <select value={familyLocation.state} onChange={(e) => setFamilyLocation((p) => ({ ...p, state: e.target.value }))}>
            {['CT', 'MA', 'NY', 'RI', 'NJ', 'NH', 'VT', 'ME'].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <button type="button" onClick={() => saveFamily('Family location saved.')}>Save location</button>
      </section>

      <section style={{ marginTop: 16, border: '1px solid #eadfff', borderRadius: 16, padding: 14, background: '#fff' }}>
        <h3 style={{ marginTop: 0 }}>Edit / Add family members</h3>
        <div style={{ display: 'grid', gap: 8 }}>
          {editableMembers.map((member, idx) => (
            <div key={`${member.id ?? 'new'}-${idx}`} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
              <input style={{ width: '100%', minWidth: 0 }} value={member.first_name} placeholder="First name" onChange={(e) => setEditableMembers((prev) => prev.map((m, i) => (i === idx ? { ...m, first_name: e.target.value } : m)))} />
              <input style={{ width: '100%', minWidth: 0 }} value={member.last_name} placeholder="Last name" onChange={(e) => setEditableMembers((prev) => prev.map((m, i) => (i === idx ? { ...m, last_name: e.target.value } : m)))} />
              <input style={{ width: '100%', minWidth: 0 }} type="date" value={member.birthdate} onChange={(e) => setEditableMembers((prev) => prev.map((m, i) => (i === idx ? { ...m, birthdate: e.target.value } : m)))} />
              <select style={{ width: '100%', minWidth: 0 }} value={member.role} onChange={(e) => setEditableMembers((prev) => prev.map((m, i) => (i === idx ? { ...m, role: e.target.value as 'adult' | 'child' } : m)))}>
                <option value="adult">Adult</option>
                <option value="child">Child</option>
              </select>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
          <button type="button" onClick={addMemberRow}>Add member</button>
          <button type="button" onClick={() => saveFamily('Family members saved.')}>Save family members</button>
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
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 280px) minmax(180px, 1fr)', gap: 10, alignItems: 'center' }}>
          <select value={selectedPersonId} onChange={(e) => setSelectedPersonId(e.target.value)}>
            <option value="">Select member for class registration</option>
            {classRegistrationOptions.map((person) => (
              <option key={person.id} value={person.id}>{person.first_name} {person.last_name ?? ''} ({person.role ?? 'member'})</option>
            ))}
          </select>
          <p style={{ margin: 0, color: '#6d6480', fontSize: 14 }}>Choose a child, then register from the class cards below.</p>
        </div>

        <div style={{ marginTop: 12 }}>
          <h4 style={{ marginBottom: 8 }}>Manual class registration</h4>
          {classes.length === 0 ? (
            <p style={{ margin: 0, color: '#6d6480' }}>No upcoming scheduled classes.</p>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
              {classes.map((klass) => {
                const selected = selectedClassId === klass.id;
                const isRegistering = registeringClassId === klass.id;
                return (
                  <article
                    key={klass.id}
                    onClick={() => setSelectedClassId(klass.id)}
                    style={{
                      border: selected ? '2px solid #7c5bcf' : '1px solid #e3d5ff',
                      borderRadius: 14,
                      padding: 12,
                      background: selected ? '#fbf8ff' : '#fff',
                      boxShadow: selected ? '0 10px 20px rgba(95,61,164,0.12)' : '0 6px 14px rgba(95,61,164,0.06)',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                      <div>
                        <p style={{ margin: '0 0 4px', color: '#4f3f82', fontWeight: 800 }}>{klass.title}</p>
                        <p style={{ margin: 0, color: '#6d6480', fontSize: 13 }}>{formatClassTimeRange(klass.start_time, klass.end_time)}</p>
                      </div>
                      <span style={{ borderRadius: 999, background: '#f3edff', color: '#5f3da4', padding: '4px 8px', fontSize: 12, fontWeight: 800, whiteSpace: 'nowrap' }}>
                        {classSeatsLabel(klass)}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
                      {klass.age_range && <span style={{ border: '1px solid #eadfff', borderRadius: 999, padding: '4px 8px', color: '#5f5470', fontSize: 12 }}>{klass.age_range}</span>}
                      {klass.caregiver_participation && <span style={{ border: '1px solid #eadfff', borderRadius: 999, padding: '4px 8px', color: '#5f5470', fontSize: 12 }}>{klass.caregiver_participation}</span>}
                      <span style={{ border: '1px solid #eadfff', borderRadius: 999, padding: '4px 8px', color: '#5f5470', fontSize: 12 }}>{formatClassPrice(klass.price_cents)}</span>
                    </div>
                    {klass.description && <p style={{ margin: '10px 0 0', color: '#6d6480', fontSize: 13, lineHeight: 1.35 }}>{klass.description}</p>}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void registerClass(klass.id);
                      }}
                      disabled={!selectedPersonId || Boolean(registeringClassId)}
                      style={{
                        width: '100%',
                        marginTop: 12,
                        border: 'none',
                        borderRadius: 12,
                        padding: '10px 12px',
                        background: !selectedPersonId || registeringClassId ? '#d7cee8' : '#5f3da4',
                        color: '#fff',
                        fontWeight: 800,
                      }}
                    >
                      {isRegistering ? 'Registering...' : classSeatsLabel(klass).toLowerCase().includes('waitlist') ? 'Add to waitlist' : 'Register'}
                    </button>
                  </article>
                );
              })}
            </div>
          )}
        </div>

        <div style={{ marginTop: 18 }}>
          <h4 style={{ marginBottom: 6 }}>Book party</h4>
          <AvailabilityCalendar title="Party calendar" slots={partySlots} initialMonth={PARTY_BOOKING_START_DATE} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
            <input type="date" min={PARTY_BOOKING_START_DATE} value={partyForm.party_date} onChange={(e) => {
              const partyDate = e.target.value;
              setPartyForm((prev) => ({
                ...prev,
                party_date: partyDate,
                slot: getPartyBookingSlotOptionsForDate(partyDate).some((slot) => slot.value === prev.slot)
                  ? prev.slot
                  : getDefaultPartyBookingSlot(partyDate),
              }));
            }} />
            <select value={partyForm.slot} onChange={(e) => setPartyForm((prev) => ({ ...prev, slot: e.target.value as PartyBookingSlot }))}>
              {partySlotOptions.map((slot) => (
                <option key={slot.value} value={slot.value}>{slot.label}</option>
              ))}
            </select>
            <input type="number" min={0} value={partyForm.headcount_expected} placeholder="Headcount" onChange={(e) => setPartyForm((prev) => ({ ...prev, headcount_expected: e.target.value }))} />
            <input value={partyForm.birthday_child_name} maxLength={80} placeholder="Birthday child name (optional)" onChange={(e) => setPartyForm((prev) => ({ ...prev, birthday_child_name: e.target.value }))} />
            <input type="number" min={1} max={21} value={partyForm.birthday_age} placeholder="Birthday age (optional)" onChange={(e) => setPartyForm((prev) => ({ ...prev, birthday_age: e.target.value }))} />
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
