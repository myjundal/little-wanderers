'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createBrowserSupabaseClient } from '@/lib/supabase/browser';
import AvailabilityCalendar, { type CalendarSlot } from '@/components/calendar/AvailabilityCalendar';

type Person = {
  id: string;
  first_name: string;
  last_name: string | null;
};

type ClassItem = {
  id: string;
  title: string;
  category: string | null;
  start_time: string;
  end_time: string;
  capacity: number | null;
  price_cents: number;
  booked_count: number;
  seats_left: number | null;
};

type RegistrationItem = {
  id: string;
  status: 'scheduled' | 'cancelled' | 'waitlist' | 'attended';
  person_name: string;
  created_at: string;
  class: {
    id: string;
    title: string;
    start_time: string;
    end_time: string;
    category: string | null;
    status: string;
  } | null;
};

export default function ClassSchedulePage() {
  const supabase = createBrowserSupabaseClient();
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [myItems, setMyItems] = useState<RegistrationItem[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [selectedPersonId, setSelectedPersonId] = useState('');
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [bookingClassId, setBookingClassId] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setMessage(null);

    const [classRes, myRes] = await Promise.all([
      fetch('/api/classes', { cache: 'no-store' }),
      fetch('/api/classes/my', { cache: 'no-store' }),
    ]);

    const classJson = await classRes.json();
    const myJson = await myRes.json();

    if (!classRes.ok || !classJson.ok) {
      setMessage(classJson.error ?? 'Failed to load classes.');
      setLoading(false);
      return;
    }

    if (!myRes.ok || !myJson.ok) {
      setMessage(myJson.error ?? 'Failed to load my classes.');
      setLoading(false);
      return;
    }

    setClasses(classJson.items ?? []);
    setMyItems(myJson.items ?? []);

    const { data: userData } = await supabase.auth.getUser();
    const uid = userData.user?.id;
    if (!uid) {
      setPeople([]);
      setSelectedPersonId('');
      setLoading(false);
      return;
    }

    const { data: households } = await supabase
      .from('households')
      .select('id')
      .eq('owner_user_id', uid)
      .order('created_at', { ascending: false })
      .limit(1);

    const householdId = households?.[0]?.id;
    if (!householdId) {
      setPeople([]);
      setSelectedPersonId('');
      setLoading(false);
      return;
    }

    const { data: ppl } = await supabase
      .from('people')
      .select('id,first_name,last_name')
      .eq('household_id', householdId)
      .order('created_at', { ascending: true });

    const casted = (ppl ?? []) as Person[];
    setPeople(casted);
    if (casted[0]?.id) setSelectedPersonId((prev) => prev || casted[0].id);

    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  const peopleNameMap = useMemo(
    () => new Map(people.map((p) => [p.id, `${p.first_name} ${p.last_name ?? ''}`.trim()])),
    [people]
  );

  const classSlots = useMemo<CalendarSlot[]>(
    () => [
      ...classes.map<CalendarSlot>((c) => ({
        id: `class-${c.id}`,
        start: c.start_time,
        end: c.end_time,
        label: c.title,
        status: c.seats_left != null && c.seats_left <= 0 ? 'full' : 'available',
      })),
      ...myItems
        .filter((item) => item.class?.start_time)
        .map<CalendarSlot>((item) => ({
          id: `mine-${item.id}`,
          start: item.class!.start_time,
          end: item.class!.end_time,
          label: item.class?.title ?? 'My class',
          status: item.status === 'cancelled' ? 'booked' : 'mine',
        })),
    ],
    [classes, myItems]
  );

  const bookClass = async (classId: string) => {
    if (!selectedPersonId) {
      alert('Please select a person before booking.');
      return;
    }

    setBookingClassId(classId);
    setMessage(null);

    const res = await fetch('/api/classes/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ class_id: classId, person_id: selectedPersonId }),
    });

    const json = await res.json();
    if (!res.ok || !json.ok) {
      setMessage(json.error ?? 'Booking failed.');
      setBookingClassId(null);
      return;
    }

    setMessage(`${peopleNameMap.get(selectedPersonId) ?? 'Selected person'} was booked successfully.`);
    setBookingClassId(null);
    await load();
  };

  const cancelRegistration = async (registrationId: string) => {
    setCancellingId(registrationId);
    setMessage(null);

    const res = await fetch('/api/classes/cancel', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ registration_id: registrationId }),
    });

    const json = await res.json();
    if (!res.ok || !json.ok) {
      setMessage(json.error ?? 'Cancellation failed.');
      setCancellingId(null);
      return;
    }

    setMessage('Your class booking has been cancelled.');
    setCancellingId(null);
    await load();
  };

  return (
    <main style={{ padding: 24, maxWidth: 980, margin: '0 auto' }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, color: '#4f3f82' }}>View Class Schedule / My Classes</h1>
      <p style={{ color: '#6f628d', marginTop: 8 }}>Browse, book, and manage your class bookings in one place.</p>

      <section style={{ marginTop: 16, padding: 12, border: '1px solid #ddd', borderRadius: 10 }}>
        <label style={{ display: 'block', marginBottom: 6, fontWeight: 500 }}>Choose a person to book</label>
        <select
          value={selectedPersonId}
          onChange={(e) => setSelectedPersonId(e.target.value)}
          style={{ minWidth: 280, padding: 6 }}
        >
          {people.length === 0 && <option value="">No people found</option>}
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.first_name} {p.last_name ?? ''}
            </option>
          ))}
        </select>
      </section>

      {message && <p style={{ marginTop: 12, color: '#5a4a8f' }}>{message}</p>}

      <AvailabilityCalendar
        title="Class calendar"
        subtitle="Purple is available, gray is full, and blue shows your booked class slots."
        slots={classSlots}
      />

      <section style={{ marginTop: 18 }}>
        <h2 style={{ fontSize: 21, margin: '0 0 10px' }}>Upcoming classes</h2>
        {loading ? (
          <p>Loading…</p>
        ) : classes.length === 0 ? (
          <p>No upcoming classes yet.</p>
        ) : (
          <div style={{ display: 'grid', gap: 12 }}>
            {classes.map((c) => {
              const isFull = c.seats_left != null && c.seats_left <= 0;
              return (
                <div key={c.id} style={{ border: '1px solid #e2e2e2', borderRadius: 10, padding: 14 }}>
                  <h3 style={{ margin: 0 }}>{c.title}</h3>
                  <p style={{ margin: '8px 0', color: '#666' }}>
                    {new Date(c.start_time).toLocaleString()} ~ {new Date(c.end_time).toLocaleTimeString()}
                  </p>
                  <p style={{ margin: '6px 0' }}>Category: {c.category ?? '-'}</p>
                  <p style={{ margin: '6px 0' }}>Price: ${(c.price_cents / 100).toFixed(2)}</p>
                  <p style={{ margin: '6px 0' }}>
                    Seats: {c.capacity == null ? 'Unlimited' : `${c.booked_count}/${c.capacity}`}{' '}
                    {c.seats_left != null && `(Left: ${c.seats_left})`}
                  </p>
                  <button
                    onClick={() => bookClass(c.id)}
                    disabled={isFull || !selectedPersonId || bookingClassId === c.id}
                  >
                    {bookingClassId === c.id ? 'Booking...' : isFull ? 'Full' : 'Book Now'}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section style={{ marginTop: 24 }}>
        <h2 style={{ fontSize: 21, margin: '0 0 10px' }}>My class bookings</h2>
        {loading ? (
          <p>Loading…</p>
        ) : myItems.length === 0 ? (
          <div style={{ border: '1px dashed #ccc', borderRadius: 12, padding: 16 }}>
            <p>You do not have any class bookings yet.</p>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 12 }}>
            {myItems.map((item) => (
              <div key={item.id} style={{ border: '1px solid #e2e2e2', borderRadius: 10, padding: 14 }}>
                <h3 style={{ margin: 0 }}>{item.class?.title ?? 'Removed class'}</h3>
                <p style={{ margin: '8px 0', color: '#666' }}>
                  Person: {item.person_name} · Status: <b style={{ textTransform: 'uppercase' }}>{item.status}</b>
                </p>
                <p style={{ margin: '6px 0' }}>
                  Time: {item.class?.start_time ? new Date(item.class.start_time).toLocaleString() : '-'}
                </p>
                <p style={{ margin: '6px 0' }}>Category: {item.class?.category ?? '-'}</p>
                {item.status !== 'cancelled' && (
                  <button onClick={() => cancelRegistration(item.id)} disabled={cancellingId === item.id}>
                    {cancellingId === item.id ? 'Cancelling...' : 'Cancel Booking'}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <p style={{ marginTop: 20 }}>
        <Link href="/landing">← Back to Homepage</Link>
      </p>
    </main>
  );
}
