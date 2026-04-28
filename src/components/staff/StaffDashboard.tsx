'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import StaffFamilyRegistration from '@/components/staff/StaffFamilyRegistration';
import Link from 'next/link';

type OccupancyEvent = {
  id: string;
  event_type: string;
  delta: number;
  created_at: string;
  notes: string | null;
};

type OccupancyState = {
  occupancy: number;
  capacity: number;
  progress: number;
  crowd_level: string;
  label: string;
  description: string;
  accent: string;
  accent_strong: string;
  effective_date: string;
  events: OccupancyEvent[];
};

type ClassItem = {
  id: string;
  title: string;
  category: string | null;
  start_time: string;
  end_time: string;
  duration_minutes: number | null;
  instructor_name: string | null;
  description: string | null;
  age_range: string | null;
  capacity: number | null;
  price_cents: number;
  status: 'scheduled' | 'cancelled' | 'completed';
  booked_count: number;
  seats_left: number | null;
  registrants: {
    registration_id: string;
    person_id: string;
    person_name: string;
    household_id: string | null;
    registration_status: 'scheduled' | 'cancelled' | 'waitlist' | 'attended';
    attendance_status: 'unknown' | 'attended' | 'cancelled' | 'no_show';
    attendance_marked_at: string | null;
    attendance_marked_by: string | null;
  }[];
};

type PartyBookingItem = {
  id: string;
  household_id: string;
  household_name: string;
  start_time: string;
  end_time: string;
  room: string | null;
  headcount_expected: number | null;
  price_quote_cents: number | null;
  notes: string | null;
  status: 'pending' | 'confirmed' | 'cancelled';
  status_updated_at: string | null;
  current_child_count: number;
  current_adult_count: number;
  final_child_count: number | null;
  final_adult_count: number | null;
  final_total_count: number | null;
  attendance_finalized_at: string | null;
  attendance_notes: string | null;
};

const sectionStyle: React.CSSProperties = {
  marginTop: 24,
  border: '1px solid #ddcff7',
  borderRadius: 24,
  background: 'linear-gradient(180deg,#fff,#faf5ff)',
  padding: 20,
  boxShadow: '0 16px 28px rgba(120,87,177,0.08)',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: 12,
  border: '1px solid #d9c8f7',
  background: '#fff',
};

const buttonStyle: React.CSSProperties = {
  border: 'none',
  borderRadius: 14,
  padding: '14px 18px',
  fontWeight: 700,
  cursor: 'pointer',
};

function emptyClassForm() {
  const start = new Date();
  start.setHours(start.getHours() + 1, 0, 0, 0);
  const end = new Date(start);
  end.setHours(end.getHours() + 1);

  return {
    title: '',
    category: '',
    date: start.toISOString().slice(0, 10),
    start_time: start.toISOString().slice(11, 16),
    end_time: end.toISOString().slice(11, 16),
    instructor_name: '',
    age_range: '',
    capacity: '12',
    price_dollars: '0',
    description: '',
    status: 'scheduled',
  };
}

function toDateTimeISO(date: string, time: string) {
  return new Date(`${date}T${time}:00`).toISOString();
}

function fromClass(item: ClassItem) {
  const start = new Date(item.start_time);
  const end = new Date(item.end_time);

  return {
    title: item.title,
    category: item.category ?? '',
    date: start.toISOString().slice(0, 10),
    start_time: start.toISOString().slice(11, 16),
    end_time: end.toISOString().slice(11, 16),
    instructor_name: item.instructor_name ?? '',
    age_range: item.age_range ?? '',
    capacity: item.capacity == null ? '' : String(item.capacity),
    price_dollars: (item.price_cents / 100).toFixed(2),
    description: item.description ?? '',
    status: item.status,
  };
}

function dollars(cents: number | null) {
  if (cents == null) return '-';
  return `$${(cents / 100).toFixed(2)}`;
}

function prettyNote(note: string | null) {
  if (!note) return '-';
  return note.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, (iso) =>
    new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  );
}

export default function StaffDashboard() {
  const [occupancy, setOccupancy] = useState<OccupancyState | null>(null);
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [partyBookings, setPartyBookings] = useState<PartyBookingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [customAdjustment, setCustomAdjustment] = useState('1');
  const [classForm, setClassForm] = useState(emptyClassForm());
  const [editingClassId, setEditingClassId] = useState<string | null>(null);
  const [savingClass, setSavingClass] = useState(false);
  const [statusNote, setStatusNote] = useState<Record<string, string>>({});
  const [selectedBookingId, setSelectedBookingId] = useState<string | null>(null);
  const [savingAttendanceKey, setSavingAttendanceKey] = useState<string | null>(null);
  const [partyAttendanceNotes, setPartyAttendanceNotes] = useState<Record<string, string>>({});

  const selectedBooking = useMemo(
    () => partyBookings.find((item) => item.id === selectedBookingId) ?? partyBookings[0] ?? null,
    [partyBookings, selectedBookingId]
  );

  useEffect(() => {
    if (!selectedBookingId && partyBookings[0]?.id) {
      setSelectedBookingId(partyBookings[0].id);
    }
  }, [partyBookings, selectedBookingId]);

  const load = useCallback(async () => {
    setLoading(true);
    setMessage(null);

    const [occupancyRes, classesRes, partyRes] = await Promise.all([
      fetch('/api/admin/occupancy', { cache: 'no-store' }),
      fetch('/api/admin/classes', { cache: 'no-store' }),
      fetch('/api/admin/party-bookings', { cache: 'no-store' }),
    ]);

    const [occupancyJson, classesJson, partyJson] = await Promise.all([
      occupancyRes.json(),
      classesRes.json(),
      partyRes.json(),
    ]);

    if (!occupancyRes.ok || !occupancyJson.ok) {
      setMessage(occupancyJson.error ?? 'Failed to load occupancy controls.');
      setLoading(false);
      return;
    }

    if (!classesRes.ok || !classesJson.ok) {
      setMessage(classesJson.error ?? 'Failed to load classes.');
      setLoading(false);
      return;
    }

    if (!partyRes.ok || !partyJson.ok) {
      setMessage(partyJson.error ?? 'Failed to load party bookings.');
      setLoading(false);
      return;
    }

    setOccupancy(occupancyJson as OccupancyState);
    setClasses((classesJson.items ?? []) as ClassItem[]);
    setPartyBookings((partyJson.items ?? []) as PartyBookingItem[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const mutateOccupancy = async (action: 'increment' | 'decrement' | 'reset', amount = 1, notes?: string) => {
    const res = await fetch('/api/admin/occupancy', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, amount, notes }),
    });
    const json = await res.json();

    if (!res.ok || !json.ok) {
      setMessage(json.error ?? 'Could not update occupancy.');
      return;
    }

    setOccupancy(json as OccupancyState);
    setMessage('Occupancy updated.');
  };

  const submitClass = async () => {
    setSavingClass(true);
    setMessage(null);

    const payload = {
      title: classForm.title,
      category: classForm.category,
      start_time: toDateTimeISO(classForm.date, classForm.start_time),
      end_time: toDateTimeISO(classForm.date, classForm.end_time),
      instructor_name: classForm.instructor_name,
      age_range: classForm.age_range,
      capacity: classForm.capacity,
      price_cents: Math.round(Number(classForm.price_dollars || '0') * 100),
      description: classForm.description,
      status: classForm.status,
    };

    const endpoint = editingClassId ? `/api/admin/classes/${editingClassId}` : '/api/admin/classes';
    const method = editingClassId ? 'PATCH' : 'POST';
    const res = await fetch(endpoint, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const json = await res.json();

    if (!res.ok || !json.ok) {
      setMessage(json.error ?? 'Could not save class.');
      setSavingClass(false);
      return;
    }

    setClassForm(emptyClassForm());
    setEditingClassId(null);
    setSavingClass(false);
    setMessage(editingClassId ? 'Class updated.' : 'Class added.');
    await load();
  };

  const deleteClass = async (classId: string) => {
    if (!window.confirm('Delete this class schedule item?')) return;

    const res = await fetch(`/api/admin/classes/${classId}`, { method: 'DELETE' });
    const json = await res.json();
    if (!res.ok || !json.ok) {
      setMessage(json.error ?? 'Could not delete class.');
      return;
    }

    setMessage('Class deleted.');
    if (editingClassId === classId) {
      setEditingClassId(null);
      setClassForm(emptyClassForm());
    }
    await load();
  };

  const updateClassAttendance = async (
    classId: string,
    registrationId: string,
    attendanceStatus: 'unknown' | 'attended' | 'cancelled' | 'no_show'
  ) => {
    const key = `${classId}:${registrationId}`;
    setSavingAttendanceKey(key);
    const res = await fetch(`/api/admin/classes/${classId}/attendance`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ registration_id: registrationId, attendance_status: attendanceStatus }),
    });
    const json = await res.json();
    setSavingAttendanceKey(null);
    if (!res.ok || !json.ok) {
      setMessage(json.error ?? 'Could not update class attendance.');
      return;
    }
    setMessage('Class attendance updated.');
    await load();
  };

  const updatePartyAttendance = async (
    bookingId: string,
    action: 'increment_child' | 'decrement_child' | 'increment_adult' | 'decrement_adult' | 'finalize' | 'reopen'
  ) => {
    const res = await fetch(`/api/admin/party-bookings/${bookingId}/headcount`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, notes: partyAttendanceNotes[bookingId] ?? '' }),
    });
    const json = await res.json();
    if (!res.ok || !json.ok) {
      setMessage(json.error ?? 'Could not update party attendance.');
      return;
    }
    setMessage(
      action === 'finalize'
        ? 'Party attendance finalized.'
        : action === 'reopen'
          ? 'Party attendance reopened.'
          : 'Party attendance updated.'
    );
    await load();
  };

  const updatePartyStatus = async (bookingId: string, status: 'cancelled') => {
    const res = await fetch(`/api/admin/party-bookings/${bookingId}/status`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status, notes: statusNote[bookingId] ?? '' }),
    });
    const json = await res.json();

    if (!res.ok || !json.ok) {
      setMessage(json.error ?? 'Could not update booking status.');
      return;
    }

    setMessage(`Party booking marked ${status}.`);
    setStatusNote((prev) => ({ ...prev, [bookingId]: '' }));
    await load();
  };

  if (loading) {
    return <div style={{ marginTop: 24 }}>Loading operator dashboard…</div>;
  }

  return (
    <>
      {message && (
        <div style={{ marginTop: 20, padding: '12px 14px', borderRadius: 16, background: '#f4ebff', color: '#5f3da4' }}>
          {message}
        </div>
      )}

      <section style={{ ...sectionStyle, marginTop: 16 }}>
        <p style={{ margin: 0, color: '#7a63a5', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Owner tools</p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
          <Link href="/owner/families" style={{ borderRadius: 12, border: '1px solid #d9c8f7', padding: '10px 12px', color: '#5f3da4', fontWeight: 700, textDecoration: 'none' }}>Family Management</Link>
          <a href="#manual-family-registration" style={{ borderRadius: 12, border: '1px solid #d9c8f7', padding: '10px 12px', color: '#5f3da4', fontWeight: 700, textDecoration: 'none' }}>Manual family registration</a>
          <a href="#occupancy-management" style={{ borderRadius: 12, border: '1px solid #d9c8f7', padding: '10px 12px', color: '#5f3da4', fontWeight: 700, textDecoration: 'none' }}>Occupancy</a>
          <a href="#class-management" style={{ borderRadius: 12, border: '1px solid #d9c8f7', padding: '10px 12px', color: '#5f3da4', fontWeight: 700, textDecoration: 'none' }}>Class management</a>
          <a href="#party-management" style={{ borderRadius: 12, border: '1px solid #d9c8f7', padding: '10px 12px', color: '#5f3da4', fontWeight: 700, textDecoration: 'none' }}>Party management</a>
        </div>
      </section>

      <div id="manual-family-registration">
        <StaffFamilyRegistration onSaved={load} />
      </div>

      <section id="occupancy-management" style={sectionStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <p style={{ margin: 0, color: '#7a63a5', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Occupancy control</p>
            <h2 style={{ margin: '8px 0 4px', color: '#4f3f82' }}>Current crowd level: {occupancy?.label ?? '-'}</h2>
            <p style={{ margin: 0, color: '#6d6480' }}>{occupancy?.description}</p>
          </div>
          <div style={{ minWidth: 220, padding: 18, borderRadius: 20, background: 'rgba(255,255,255,0.9)', border: '1px solid #e2d5f8' }}>
            <div style={{ fontSize: 34, fontWeight: 800, color: '#4f3f82' }}>{occupancy?.occupancy ?? 0}</div>
            <div style={{ color: '#6d6480' }}>Approximate guests in the space now</div>
            <div style={{ marginTop: 12, height: 12, borderRadius: 999, background: '#ebddff', overflow: 'hidden' }}>
              <div style={{ width: `${Math.min((occupancy?.progress ?? 0) * 100, 100)}%`, height: '100%', background: `linear-gradient(90deg, ${occupancy?.accent ?? '#eadcff'}, ${occupancy?.accent_strong ?? '#5f3da4'})` }} />
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginTop: 20 }}>
          {[
            { label: '+2', action: () => mutateOccupancy('increment', 2) },
            { label: '+3', action: () => mutateOccupancy('increment', 3) },
            { label: '-1', action: () => mutateOccupancy('decrement', 1) },
            { label: '-2', action: () => mutateOccupancy('decrement', 2) },
            { label: '-3', action: () => mutateOccupancy('decrement', 3) },
          ].map((item) => (
            <button
              key={item.label}
              onClick={item.action}
              style={{ ...buttonStyle, background: '#f3ebff', color: '#5f3da4', minHeight: 62 }}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginTop: 16 }}>
          <input value={customAdjustment} onChange={(e) => setCustomAdjustment(e.target.value)} inputMode="numeric" style={{ ...inputStyle, maxWidth: 120 }} />
          <button style={{ ...buttonStyle, background: '#e8dcff', color: '#5f3da4' }} onClick={() => mutateOccupancy('increment', Math.max(Number(customAdjustment) || 1, 1), 'Manual increment from dashboard')}>Custom +</button>
          <button style={{ ...buttonStyle, background: '#fff0fb', color: '#8a3f6b' }} onClick={() => mutateOccupancy('decrement', Math.max(Number(customAdjustment) || 1, 1), 'Manual decrement from dashboard')}>Custom -</button>
          <button style={{ ...buttonStyle, background: '#5f3da4', color: '#fff' }} onClick={() => mutateOccupancy('reset', 1, 'Daily reset from staff dashboard')}>Reset Today</button>
        </div>
      </section>

      <section id="class-management" style={sectionStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <p style={{ margin: 0, color: '#7a63a5', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Class schedule management</p>
            <h2 style={{ margin: '8px 0 4px', color: '#4f3f82' }}>{editingClassId ? 'Edit class schedule' : 'Add a new class'}</h2>
            <p style={{ margin: 0, color: '#6d6480' }}>Create, update, or remove classes while keeping customer-facing capacity counts in sync.</p>
          </div>
          {editingClassId && (
            <button style={{ ...buttonStyle, background: '#f3ebff', color: '#5f3da4' }} onClick={() => {
              setEditingClassId(null);
              setClassForm(emptyClassForm());
            }}>Cancel edit</button>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginTop: 18 }}>
          <input placeholder="Class title" value={classForm.title} onChange={(e) => setClassForm((prev) => ({ ...prev, title: e.target.value }))} style={inputStyle} />
          <input placeholder="Category" value={classForm.category} onChange={(e) => setClassForm((prev) => ({ ...prev, category: e.target.value }))} style={inputStyle} />
          <input type="date" value={classForm.date} onChange={(e) => setClassForm((prev) => ({ ...prev, date: e.target.value }))} style={inputStyle} />
          <input type="time" value={classForm.start_time} onChange={(e) => setClassForm((prev) => ({ ...prev, start_time: e.target.value }))} style={inputStyle} />
          <input type="time" value={classForm.end_time} onChange={(e) => setClassForm((prev) => ({ ...prev, end_time: e.target.value }))} style={inputStyle} />
          <input placeholder="Instructor (optional)" value={classForm.instructor_name} onChange={(e) => setClassForm((prev) => ({ ...prev, instructor_name: e.target.value }))} style={inputStyle} />
          <input placeholder="Age(s) (optional, e.g. 2-4 years)" value={classForm.age_range} onChange={(e) => setClassForm((prev) => ({ ...prev, age_range: e.target.value }))} style={inputStyle} />
          <input type="number" min={0} placeholder="Capacity" value={classForm.capacity} onChange={(e) => setClassForm((prev) => ({ ...prev, capacity: e.target.value }))} style={inputStyle} />
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: 12, top: 8, color: '#9b90b6', fontSize: 12, fontWeight: 700, letterSpacing: '0.03em' }}>Price</span>
            <span style={{ position: 'absolute', left: 12, top: 28, color: '#6d6480', fontWeight: 700 }}>$</span>
            <input
              type="number"
              min={0}
              step="0.01"
              placeholder="0.00"
              value={classForm.price_dollars}
              onChange={(e) => setClassForm((prev) => ({ ...prev, price_dollars: e.target.value }))}
              style={{ ...inputStyle, paddingTop: 24, paddingLeft: 28 }}
            />
          </div>
          <select value={classForm.status} onChange={(e) => setClassForm((prev) => ({ ...prev, status: e.target.value }))} style={inputStyle}>
            <option value="scheduled">Scheduled</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
        <textarea rows={4} placeholder="Notes / description (optional)" value={classForm.description} onChange={(e) => setClassForm((prev) => ({ ...prev, description: e.target.value }))} style={{ ...inputStyle, marginTop: 12 }} />
        <button style={{ ...buttonStyle, background: '#5f3da4', color: '#fff', marginTop: 14 }} disabled={savingClass} onClick={submitClass}>
          {savingClass ? 'Saving...' : editingClassId ? 'Save Changes' : 'Create Class'}
        </button>

        <div style={{ marginTop: 22, display: 'grid', gap: 12 }}>
          {classes.map((item) => (
            <div key={item.id} style={{ border: '1px solid #eadfff', borderRadius: 18, padding: 16, background: '#fff' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <h3 style={{ margin: 0, color: '#4f3f82' }}>{item.title}</h3>
                  <p style={{ margin: '6px 0', color: '#6d6480' }}>
                    {new Date(item.start_time).toLocaleString()} — {new Date(item.end_time).toLocaleTimeString()} · {item.duration_minutes ?? 0} min
                  </p>
                  <p style={{ margin: '6px 0', color: '#6d6480' }}>Instructor: {item.instructor_name ?? '-'} · Category: {item.category ?? '-'}</p>
                  <p style={{ margin: '6px 0', color: '#6d6480' }}>Age(s): {item.age_range ?? '-'}</p>
                  <p style={{ margin: '6px 0', color: '#6d6480' }}>Capacity: {item.capacity == null ? 'Unlimited' : `${item.booked_count}/${item.capacity} booked`} · Seats left: {item.seats_left ?? 'Unlimited'}</p>
                  <p style={{ margin: '6px 0', color: '#6d6480' }}>Status: <strong style={{ textTransform: 'capitalize' }}>{item.status}</strong> · Price: {dollars(item.price_cents)}</p>
                  {item.description && <p style={{ margin: '6px 0', color: '#6d6480' }}>{item.description}</p>}
                  <div style={{ marginTop: 12, border: '1px solid #efe3ff', borderRadius: 12, padding: 10, background: '#fcf9ff' }}>
                    <p style={{ margin: '0 0 8px', color: '#5f3da4', fontWeight: 700 }}>Registrant attendance checklist</p>
                    {item.registrants.length === 0 ? (
                      <p style={{ margin: 0, color: '#7a6d97' }}>No registrants yet.</p>
                    ) : (
                      <div style={{ display: 'grid', gap: 8 }}>
                        {item.registrants.map((reg) => {
                          const key = `${item.id}:${reg.registration_id}`;
                          return (
                            <div key={reg.registration_id} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 220px', gap: 8, alignItems: 'center' }}>
                              <div>
                                <div style={{ fontWeight: 600, color: '#4f3f82' }}>{reg.person_name}</div>
                                <div style={{ color: '#7a6d97', fontSize: 12 }}>Registration: {reg.registration_status}</div>
                              </div>
                              <select
                                value={reg.attendance_status}
                                disabled={savingAttendanceKey === key}
                                onChange={(e) => updateClassAttendance(item.id, reg.registration_id, e.target.value as 'unknown' | 'attended' | 'cancelled' | 'no_show')}
                                style={inputStyle}
                              >
                                <option value="unknown">Unknown / not marked</option>
                                <option value="attended">Attended</option>
                                <option value="cancelled">Cancelled</option>
                                <option value="no_show">Not attended / no-show</option>
                              </select>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  <button style={{ ...buttonStyle, background: '#f3ebff', color: '#5f3da4' }} onClick={() => {
                    setEditingClassId(item.id);
                    setClassForm(fromClass(item));
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}>Edit</button>
                  <button style={{ ...buttonStyle, background: '#fff0fb', color: '#8a3f6b' }} onClick={() => deleteClass(item.id)}>Delete</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section id="party-management" style={sectionStyle}>
        <p style={{ margin: 0, color: '#7a63a5', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Party booking management</p>
        <h2 style={{ margin: '8px 0 4px', color: '#4f3f82' }}>Review and manage scheduled party bookings</h2>
        <p style={{ margin: 0, color: '#6d6480' }}>Status changes are written back immediately so the customer view stays in sync.</p>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.1fr) minmax(0, 1fr)', gap: 16, marginTop: 18 }}>
          <div style={{ display: 'grid', gap: 12 }}>
            {partyBookings.map((item) => (
              <button
                key={item.id}
                onClick={() => setSelectedBookingId(item.id)}
                style={{
                  textAlign: 'left',
                  borderRadius: 18,
                  padding: 16,
                  border: selectedBooking?.id === item.id ? '2px solid #8a63d2' : '1px solid #eadfff',
                  background: '#fff',
                  cursor: 'pointer',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                  <strong style={{ color: '#4f3f82' }}>{item.household_name}</strong>
                  <span style={{ color: item.status === 'confirmed' ? '#2f7a47' : item.status === 'cancelled' ? '#8a3f6b' : '#87631d', fontWeight: 700, textTransform: 'capitalize' }}>{item.status}</span>
                </div>
                <div style={{ marginTop: 6, color: '#6d6480' }}>{new Date(item.start_time).toLocaleString()} → {new Date(item.end_time).toLocaleString()}</div>
                <div style={{ marginTop: 6, color: '#6d6480' }}>Guests: {item.headcount_expected ?? '-'} · Quote: {dollars(item.price_quote_cents)}</div>
              </button>
            ))}
          </div>

          <div style={{ borderRadius: 20, border: '1px solid #eadfff', background: '#fff', padding: 18 }}>
            {!selectedBooking ? (
              <p>No party requests yet.</p>
            ) : (
              <>
                <h3 style={{ marginTop: 0, color: '#4f3f82' }}>{selectedBooking.household_name}</h3>
                <p style={{ color: '#6d6480' }}><strong>When:</strong> {new Date(selectedBooking.start_time).toLocaleString()} → {new Date(selectedBooking.end_time).toLocaleString()}</p>
                <p style={{ color: '#6d6480' }}><strong>Status:</strong> <span style={{ textTransform: 'capitalize' }}>{selectedBooking.status}</span></p>
                <p style={{ color: '#6d6480' }}><strong>Headcount (requested):</strong> {selectedBooking.headcount_expected ?? '-'}</p>
                <p style={{ color: '#6d6480' }}><strong>Quoted price:</strong> {dollars(selectedBooking.price_quote_cents)}</p>
                <p style={{ color: '#6d6480' }}><strong>Notes:</strong> {prettyNote(selectedBooking.notes)}</p>
                <div style={{ marginTop: 10, border: '1px solid #eadfff', borderRadius: 12, padding: 10, background: '#fcf9ff' }}>
                  <p style={{ margin: '0 0 8px', color: '#5f3da4', fontWeight: 700 }}>Party attendance tracker</p>
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                    <div>
                      <div style={{ fontSize: 12, color: '#7a6d97' }}>Children</div>
                      <div style={{ fontSize: 24, fontWeight: 800, color: '#4f3f82' }}>{selectedBooking.current_child_count}</div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button style={{ ...buttonStyle, background: '#f3ebff', color: '#5f3da4' }} disabled={Boolean(selectedBooking.attendance_finalized_at)} onClick={() => updatePartyAttendance(selectedBooking.id, 'decrement_child')}>-</button>
                        <button style={{ ...buttonStyle, background: '#f3ebff', color: '#5f3da4' }} disabled={Boolean(selectedBooking.attendance_finalized_at)} onClick={() => updatePartyAttendance(selectedBooking.id, 'increment_child')}>+</button>
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 12, color: '#7a6d97' }}>Adults</div>
                      <div style={{ fontSize: 24, fontWeight: 800, color: '#4f3f82' }}>{selectedBooking.current_adult_count}</div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button style={{ ...buttonStyle, background: '#f3ebff', color: '#5f3da4' }} disabled={Boolean(selectedBooking.attendance_finalized_at)} onClick={() => updatePartyAttendance(selectedBooking.id, 'decrement_adult')}>-</button>
                        <button style={{ ...buttonStyle, background: '#f3ebff', color: '#5f3da4' }} disabled={Boolean(selectedBooking.attendance_finalized_at)} onClick={() => updatePartyAttendance(selectedBooking.id, 'increment_adult')}>+</button>
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 12, color: '#7a6d97' }}>Current total</div>
                      <div style={{ fontSize: 24, fontWeight: 800, color: '#4f3f82' }}>{selectedBooking.current_child_count + selectedBooking.current_adult_count}</div>
                    </div>
                  </div>
                  <textarea rows={2} placeholder="Optional final attendance notes" value={partyAttendanceNotes[selectedBooking.id] ?? selectedBooking.attendance_notes ?? ''} onChange={(e) => setPartyAttendanceNotes((prev) => ({ ...prev, [selectedBooking.id]: e.target.value }))} style={{ ...inputStyle, marginTop: 10 }} />
                  {selectedBooking.attendance_finalized_at ? (
                    <div style={{ marginTop: 10, padding: 10, borderRadius: 10, background: '#ebf8ef', border: '1px solid #cae9d2' }}>
                      <p style={{ margin: '0 0 6px', color: '#2f7a47', fontWeight: 700 }}>Attendance finalized at {new Date(selectedBooking.attendance_finalized_at).toLocaleString()}</p>
                      <p style={{ margin: '2px 0' }}>Final children: {selectedBooking.final_child_count ?? 0}</p>
                      <p style={{ margin: '2px 0' }}>Final adults: {selectedBooking.final_adult_count ?? 0}</p>
                      <p style={{ margin: '2px 0', fontWeight: 700 }}>Final total: {selectedBooking.final_total_count ?? 0}</p>
                      <button style={{ ...buttonStyle, marginTop: 8, background: '#fff', color: '#2f7a47', border: '1px solid #8fcea0' }} onClick={() => updatePartyAttendance(selectedBooking.id, 'reopen')}>Reopen attendance (explicit edit)</button>
                    </div>
                  ) : (
                    <button style={{ ...buttonStyle, marginTop: 10, background: '#2f7a47', color: '#fff' }} onClick={() => updatePartyAttendance(selectedBooking.id, 'finalize')}>Finalize attendance</button>
                  )}
                </div>
                <p style={{ color: '#6d6480' }}>
                  <strong>{selectedBooking.status === 'cancelled' ? 'Cancelled on:' : 'Last status change:'}</strong>{' '}
                  {selectedBooking.status_updated_at ? new Date(selectedBooking.status_updated_at).toLocaleString() : '-'}
                </p>
                <textarea rows={3} placeholder="Optional staff note for this status change" value={statusNote[selectedBooking.id] ?? ''} onChange={(e) => setStatusNote((prev) => ({ ...prev, [selectedBooking.id]: e.target.value }))} style={{ ...inputStyle, marginTop: 12 }} />
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 12 }}>
                  {selectedBooking.status !== 'cancelled' && (
                    <button style={{ ...buttonStyle, background: '#fff0fb', color: '#8a3f6b' }} onClick={() => updatePartyStatus(selectedBooking.id, 'cancelled')}>Cancel booking</button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </section>
      <div style={{ marginTop: 16 }}>
        <a href="/landing" style={{ display: 'inline-block', padding: '10px 14px', borderRadius: 12, background: '#f3ebff', color: '#5f3da4', fontWeight: 700, textDecoration: 'none' }}>
          Return to customer dashboard
        </a>
      </div>
    </>
  );
}
