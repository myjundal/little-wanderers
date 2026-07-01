'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import AvailabilityCalendar, { type CalendarSlot } from '@/components/calendar/AvailabilityCalendar';
import { createBrowserSupabaseClient } from '@/lib/supabase/browser';

type PartyBooking = {
  id: string;
  start_time: string;
  end_time: string;
  headcount_expected: number | null;
  price_quote_cents: number | null;
  notes: string | null;
  status: 'pending' | 'confirmed' | 'cancelled' | 'early_access_hold';
  status_updated_at: string | null;
  created_at: string;
  final_child_count: number | null;
  final_adult_count: number | null;
  final_total_count: number | null;
  attendance_finalized_at: string | null;
  birthday_child_name: string | null;
  birthday_age: number | null;
  occasion_details: string | null;
};

function toIsoLocal(date: string, hourLocal: number) {
  return new Date(`${date}T${String(hourLocal).padStart(2, '0')}:00:00`).toISOString();
}

function getDefaultPartyDate() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  for (let i = 0; i < 14; i += 1) {
    const day = d.getUTCDay();
    if (day === 5 || day === 6 || day === 0) return d.toISOString().slice(0, 10);
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return new Date().toISOString().slice(0, 10);
}

function isPartyDate(date: string) {
  const d = new Date(`${date}T00:00:00.000Z`);
  const day = d.getUTCDay();
  return day === 5 || day === 6 || day === 0;
}

function getPartyWeekDates(anchor: string) {
  const d = new Date(`${anchor}T00:00:00`);
  const friday = new Date(d);
  friday.setDate(d.getDate() + ((5 - d.getDay() + 7) % 7));
  const saturday = new Date(friday);
  saturday.setDate(friday.getDate() + 1);
  const sunday = new Date(friday);
  sunday.setDate(friday.getDate() + 2);
  return [friday, saturday, sunday].map((item) => item.toISOString().slice(0, 10));
}

function prettyNote(note: string | null) {
  if (!note) return '-';
  return note.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, (iso) =>
    new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  );
}

export default function PartyPage() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [items, setItems] = useState<PartyBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [bookedSlots, setBookedSlots] = useState<{ id: string; start_time: string; end_time: string }[]>([]);
  const [requestingCancelId, setRequestingCancelId] = useState<string | null>(null);
  const finalizingPaymentRef = useRef(false);
  const [rescheduleBookingId, setRescheduleBookingId] = useState<string | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState(getDefaultPartyDate());
  const [rescheduleSlot, setRescheduleSlot] = useState<'11:00' | '15:00'>('11:00');
  const [selectedMobileDate, setSelectedMobileDate] = useState<string>('');
  const [selectedMobileWeek, setSelectedMobileWeek] = useState<string>('');

  const [form, setForm] = useState({
    party_date: getDefaultPartyDate(),
    slot: '11:00',
    headcount_expected: '',
    notes: '',
    birthday_child_name: '',
    birthday_age: '',
    occasion_details: '',
  });

  const startIso = useMemo(() => toIsoLocal(form.party_date, form.slot === '15:00' ? 15 : 11), [form.party_date, form.slot]);
  const endIso = useMemo(() => toIsoLocal(form.party_date, form.slot === '15:00' ? 18 : 14), [form.party_date, form.slot]);

  const load = useCallback(async () => {
    setLoading(true);
    const requestKey = Date.now();
    const supabase = createBrowserSupabaseClient();
    const [bookingsRes, authRes] = await Promise.all([
      fetch(`/api/party-bookings?ts=${requestKey}`, { cache: 'no-store' }),
      supabase.auth.getUser(),
    ]);
    const bookingsJson = await bookingsRes.json();
    setIsAuthenticated(Boolean(authRes.data.user?.id));

    if (!bookingsRes.ok || !bookingsJson.ok) {
      if (bookingsRes.status === 401) {
        setItems([]);
      } else {
        setMessage(bookingsJson.error ?? 'Could not load party bookings.');
        setLoading(false);
        return;
      }
    } else {
      setItems((bookingsJson.items ?? []) as PartyBooking[]);
    }

    const calendarRes = await fetch(`/api/party-bookings/calendar?ts=${requestKey}`, { cache: 'no-store' });
    const calendarJson = await calendarRes.json();
    if (calendarRes.ok && calendarJson.ok) {
      setBookedSlots(calendarJson.items ?? []);
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const interval = window.setInterval(() => {
      load();
    }, 10000);

    return () => window.clearInterval(interval);
  }, [load]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('party_checkout') !== 'success') return;
    if (finalizingPaymentRef.current) return;

    const startTime = params.get('start_time');
    const endTime = params.get('end_time');
    const bookingId = params.get('booking_id');
      const headcount = params.get('headcount_expected');
      const slot = params.get('slot');
    const notes = params.get('notes');
    const birthdayChildName = params.get('birthday_child_name');
    const birthdayAge = params.get('birthday_age');
    const occasionDetails = params.get('occasion_details');
    if (!startTime || !endTime) return;

    const finalize = async () => {
      finalizingPaymentRef.current = true;
      setSubmitting(true);
      const res = await fetch('/api/party-bookings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mode: 'finalize',
          booking_id: bookingId || undefined,
          start_time: startTime,
          end_time: endTime,
          headcount_expected: headcount ? Number(headcount) : null,
          notes: notes || null,
          birthday_child_name: birthdayChildName || null,
          birthday_age: birthdayAge ? Number(birthdayAge) : null,
          occasion_details: occasionDetails || null,
          slot: slot || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setMessage(json.error ?? 'Could not finalize party booking after payment.');
        setSubmitting(false);
        finalizingPaymentRef.current = false;
        return;
      }

      setMessage('Deposit paid. Your party is scheduled.');
      setSubmitting(false);
      finalizingPaymentRef.current = false;
      await load();
      window.history.replaceState({}, '', '/landing/party');
    };

    void finalize();
  }, [load]);

  const submit = async () => {
    if (!isAuthenticated) {
      sessionStorage.setItem('post_login_redirect', '/party');
      window.location.assign('/login');
      return;
    }
    setSubmitting(true);
    setMessage(null);

    if (!isPartyDate(form.party_date)) {
      setMessage('Please choose a Friday, Saturday, or Sunday.');
      setSubmitting(false);
      return;
    }
    const birthdayAgeValue = form.birthday_age.trim();
    if (birthdayAgeValue) {
      const parsedAge = Number(birthdayAgeValue);
      if (!Number.isInteger(parsedAge) || parsedAge <= 0 || parsedAge > 21) {
        setMessage('Please enter a valid birthday age (1-21).');
        setSubmitting(false);
        return;
      }
    }
    if (form.occasion_details.length > 120) {
      setMessage('Occasion details can be up to 120 characters.');
      setSubmitting(false);
      return;
    }

    const res = await fetch('/api/party-bookings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        mode: 'early_access_hold',
        start_time: startIso,
        end_time: endIso,
        headcount_expected: form.headcount_expected ? Number(form.headcount_expected) : null,
        notes: form.notes || null,
        birthday_child_name: form.birthday_child_name.trim() || null,
        birthday_age: birthdayAgeValue ? Number(birthdayAgeValue) : null,
        occasion_details: form.occasion_details.trim() || null,
        slot: form.slot,
      }),
    });

    const json = await res.json();
    if (!res.ok || !json.ok) {
      setMessage(json.error ?? 'Request failed. Please try again.');
      setSubmitting(false);
      return;
    }

    setMessage('Your party hold request is saved. We will contact you after our official opening so you can visit the space before deciding on the deposit.');
    setSubmitting(false);
    await load();
  };

  const requestCancel = async (bookingId: string) => {
    setRequestingCancelId(bookingId);
    setMessage(null);

    const res = await fetch('/api/party-bookings/request-cancel', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ booking_id: bookingId }),
    });

    const json = await res.json();
    if (!res.ok || !json.ok) {
      setMessage(json.error ?? 'Failed to request cancellation.');
      setRequestingCancelId(null);
      return;
    }

    if (json.email_sent === false) {
      setMessage('Cancellation requested. Booking updated, but email sending is not configured yet.');
    } else {
      setMessage('Cancellation requested. We sent a cancellation request email to the admin.');
    }

    setRequestingCancelId(null);
    await load();
  };

  const slots: CalendarSlot[] = [
    ...(() => {
      const generated: CalendarSlot[] = [];
      const now = new Date();
      for (let i = 0; i < 84; i += 1) {
        const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + i));
        const day = d.getUTCDay();
        if (day !== 5 && day !== 6 && day !== 0) continue;
        const dayStr = d.toISOString().slice(0, 10);
        const start11 = toIsoLocal(dayStr, 11);
        const start15 = toIsoLocal(dayStr, 15);
        const blockedStarts = new Set(
          [...bookedSlots, ...items.filter((item) => item.status !== 'cancelled')].map((item) =>
            new Date(item.start_time).getTime()
          )
        );
        if (!blockedStarts.has(new Date(start11).getTime())) {
          generated.push({
            id: `avail-${dayStr}-11`,
            start: start11,
            end: toIsoLocal(dayStr, 14),
            label: 'Available party slot',
            status: 'available',
          });
        }
        if (!blockedStarts.has(new Date(start15).getTime())) {
          generated.push({
            id: `avail-${dayStr}-15`,
            start: start15,
            end: toIsoLocal(dayStr, 18),
            label: 'Available party slot',
            status: 'available',
          });
        }
      }
      return generated;
    })(),
    ...bookedSlots
      .filter(
        (slot) =>
          !items.some(
            (item) =>
              item.status !== 'cancelled' &&
              Math.abs(new Date(item.start_time).getTime() - new Date(slot.start_time).getTime()) < 60_000
          )
      )
      .map((slot) => ({
      id: `booked-${slot.id}`,
      start: slot.start_time,
      end: slot.end_time,
      label: 'Reserved slot',
      status: 'booked' as const,
      })),
    ...items.filter((item) => item.status !== 'cancelled').map((item) => ({
      id: `mine-${item.id}`,
      start: item.start_time,
      end: item.end_time,
      label: 'My party',
      status: 'mine' as const,
    })),
  ];

  const mobileAvailableSlots = slots.filter((slot) => slot.status === 'available' || slot.status === 'mine');
  const partyWeekAnchor = selectedMobileWeek || new Date().toISOString().slice(0, 10);
  const partyWeekDates = getPartyWeekDates(partyWeekAnchor);
  const activeMobileDate = selectedMobileDate || partyWeekDates[0];

  const selectSlot = (slot: CalendarSlot) => {
    if (slot.status !== 'available') return;
    const start = new Date(slot.start);
    const hour = start.getHours();
    setForm((prev) => ({
      ...prev,
      party_date: slot.start.slice(0, 10),
      slot: hour >= 15 ? '15:00' : '11:00',
    }));
    setSelectedMobileDate(slot.start.slice(0, 10));
    setMessage(null);
  };

  const reschedule = async (bookingId: string) => {
    const nextStart = toIsoLocal(rescheduleDate, rescheduleSlot === '15:00' ? 15 : 11);
    const nextEnd = toIsoLocal(rescheduleDate, rescheduleSlot === '15:00' ? 18 : 14);
    const res = await fetch('/api/party-bookings/reschedule', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ booking_id: bookingId, start_time: nextStart, end_time: nextEnd, slot: rescheduleSlot }),
    });
    const json = await res.json();
    if (!res.ok || !json.ok) {
      setMessage(json.error ?? 'Could not reschedule.');
      return;
    }
    setMessage('Party booking rescheduled.');
    setRescheduleBookingId(null);
    await load();
  };

  return (
    <main style={{ padding: '16px clamp(12px, 4vw, 24px)', maxWidth: 860, margin: '0 auto', boxSizing: 'border-box', background: 'linear-gradient(180deg,#fff,#f7efff)', border: '1px solid #e3d0fb', borderRadius: 28, boxShadow: '0 18px 30px rgba(120,87,177,0.12)' }}>
      <h1 style={{ fontSize: 28, fontWeight: 800, color: '#4f3f82' }}>🎉 My Party Bookings</h1>
      <p style={{ color: '#6f628d', marginTop: 8 }}>Choose a Friday, Saturday, or Sunday party slot and request an early access hold. No deposit is collected today.</p>

      {message && <p style={{ marginTop: 12 }}>{message}</p>}

      <div className="desktopCalendar">
        <AvailabilityCalendar
          title="Party booking calendar"
          subtitle="Select an available slot to fill the booking form below."
          slots={slots}
          onSlotSelect={selectSlot}
        />
      </div>
      <section className="mobileSlots" style={{ marginTop: 12 }}>
        <h3 style={{ margin: '0 0 10px', color: '#4f3f82' }}>Choose a week</h3>
        <input type="date" value={partyWeekAnchor} onChange={(e) => { setSelectedMobileWeek(e.target.value); setSelectedMobileDate(''); }} style={{ width: '100%', border: '1px solid #dbcdf5', borderRadius: 10, padding: '8px 10px', marginBottom: 10 }} />
        <div style={{ display: 'grid', gap: 10 }}>
          {partyWeekDates.map((date) => {
            const daySlots = mobileAvailableSlots
              .filter((slot) => new Date(slot.start).toISOString().slice(0, 10) === date)
              .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
            const selected = date === activeMobileDate;

            return (
              <article key={`mobile-day-${date}`} style={{ border: selected ? '2px solid #9b7fd1' : '1px solid #e3d4fa', borderRadius: 14, padding: 12, background: selected ? '#fbf8ff' : '#fff' }}>
                <p style={{ margin: 0, fontWeight: 800, color: '#4f3f82' }}>{new Date(`${date}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', weekday: 'long' })}</p>
                <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
                  {daySlots.length === 0 ? (
                    <p style={{ margin: 0, color: '#6f628d' }}>No available party slots for this date.</p>
                  ) : (
                    daySlots.map((slot) => {
                      const isSelectedSlot = form.party_date === slot.start.slice(0, 10) && form.slot === (new Date(slot.start).getHours() >= 15 ? '15:00' : '11:00');
                      return (
                        <button
                          key={`slot-${slot.id}`}
                          type="button"
                          onClick={() => selectSlot(slot)}
                          disabled={slot.status === 'mine'}
                          style={{
                            borderRadius: 12,
                            border: isSelectedSlot ? '2px solid #5f3da4' : '1px solid #dbcdf5',
                            background: isSelectedSlot ? '#f1e9ff' : '#fff',
                            color: slot.status === 'mine' ? '#5f3da4' : '#2f7a47',
                            padding: '10px 12px',
                            fontWeight: 800,
                            textAlign: 'left',
                          }}
                        >
                          {new Date(slot.start).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase()} - {new Date(slot.end).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase()} · {slot.status === 'mine' ? 'Reserved by you' : 'Available'}
                        </button>
                      );
                    })
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section style={{ marginTop: 16, border: '1px solid #dfccfb', borderRadius: 14, background: '#fff', padding: 14 }}>
        <h3 style={{ marginTop: 0, color: '#4f3f82' }}>🪐 New party booking</h3>

        <div style={{ marginBottom: 14, padding: 12, borderRadius: 10, border: '1px solid #eadfff', background: '#faf5ff' }}>
          <strong>Early access party holds:</strong>
          <ul style={{ margin: '10px 0 0 20px', display: 'grid', gap: 6, lineHeight: 1.5 }}>
            <li>We are giving waitlist families first priority for party dates.</li>
            <li>During early access, we will hold your selected party slot without collecting a deposit today.</li>
            <li>After our official opening, we will contact you so you can visit the space.</li>
            <li>If you love it and want to keep the booking, we will collect the 50% deposit ($150) then, with the remaining balance due upon arrival before setup.</li>
            <li>Final guest count is due 3 days before party day.</li>
          </ul>
        </div>

        <div style={{ display: 'grid', gap: 10 }}>
          <p style={{ margin: 0, color: '#6f628d', fontSize: 14 }}>
            Most parties are birthdays, but you can also use this for baby showers, baby namings, family celebrations, or other special occasions.
          </p>
          <label>
            Party date
            <br />
            <input style={{ width: '100%', minWidth: 0, boxSizing: 'border-box' }} type="date" value={form.party_date} onChange={(e) => setForm((prev) => ({ ...prev, party_date: e.target.value }))} />
          </label>

          <label>
            Time
            <br />
            <select style={{ width: '100%', minWidth: 0, boxSizing: 'border-box' }} value={form.slot} onChange={(e) => setForm((prev) => ({ ...prev, slot: e.target.value }))}>
              <option value="11:00">11:00 AM (ends at 2:00 PM)</option>
              <option value="15:00">3:00 PM (ends at 6:00 PM)</option>
            </select>
          </label>

          <label>
            Birthday child&apos;s name (optional)
            <br />
            <input style={{ width: '100%', minWidth: 0, boxSizing: 'border-box' }} value={form.birthday_child_name} maxLength={80} onChange={(e) => setForm((prev) => ({ ...prev, birthday_child_name: e.target.value }))} />
          </label>

          <label>
            Age they are turning (optional)
            <br />
            <input style={{ width: '100%', minWidth: 0, boxSizing: 'border-box' }} type="number" min={1} max={21} value={form.birthday_age} onChange={(e) => setForm((prev) => ({ ...prev, birthday_age: e.target.value }))} />
          </label>

          <label>
            If this is not a birthday party, what is this for and who is this for? (optional, i.e. Baby naming for Maya)
            <br />
            <input style={{ width: '100%', minWidth: 0, boxSizing: 'border-box' }}
              value={form.occasion_details}
              maxLength={120}
              onChange={(e) => setForm((prev) => ({ ...prev, occasion_details: e.target.value }))}
            />
          </label>

          <label>
            Expected guests (optional)
            <br />
            <input style={{ width: '100%', minWidth: 0, boxSizing: 'border-box' }}
              type="number"
              min={1}
              value={form.headcount_expected}
              onChange={(e) => setForm((prev) => ({ ...prev, headcount_expected: e.target.value }))}
            />
          </label>

          <label>
            Notes (optional)
            <br />
            <textarea style={{ width: '100%', minWidth: 0, boxSizing: 'border-box' }} rows={3} value={form.notes} onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))} />
          </label>

          <button style={{ width: '100%' }} onClick={submit} disabled={submitting}>
            {submitting ? 'Requesting hold...' : 'Request to hold'}
          </button>
        </div>
      </section>

      <section style={{ marginTop: 22 }}>
        <details>
          <summary style={{ color: '#4f3f82', cursor: 'pointer', fontWeight: 700 }}>▸ 📒 My current booking/history</summary>
        {loading ? (
          <p>Loading…</p>
        ) : items.length === 0 ? (
          <p>You do not have any party bookings yet.</p>
        ) : (
          <div style={{ display: 'grid', gap: 12 }}>
            {items.map((item) => {
              const isUpcoming = new Date(item.start_time).getTime() > Date.now();
              const cancellationRequested = (item.notes ?? '').includes('[Cancellation requested');

              return (
                <div key={item.id} style={{ border: '1px solid #e3d4fa', borderRadius: 14, padding: 12, background: '#fff', boxShadow: '0 6px 16px rgba(138, 103, 193, 0.08)' }}>
                  <p style={{ margin: 0, fontWeight: 600 }}>
                    {new Date(item.start_time).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).toLowerCase()} ~ {new Date(item.end_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase()}
                  </p>
                  {item.birthday_child_name && (
                    <p style={{ margin: '6px 0' }}>
                      Birthday: {item.birthday_child_name}
                      {item.birthday_age ? ` — turning ${item.birthday_age}` : ''}
                    </p>
                  )}
                  {item.occasion_details && (
                    <p style={{ margin: '6px 0' }}>Occasion: {item.occasion_details}</p>
                  )}
                  <p style={{ margin: '6px 0' }}>Expected guests: {item.headcount_expected ?? '-'}</p>
                  <p style={{ margin: '6px 0' }}>
                    Party fee:{' '}
                    {item.price_quote_cents == null ? '-' : `$${(item.price_quote_cents / 100).toFixed(2)}`}
                  </p>
                  <p style={{ margin: '6px 0', color: '#555' }}>Notes: {prettyNote(item.notes)}</p>
                  <p style={{ margin: '6px 0', color: '#6a6082' }}>Last updated: {item.status_updated_at ? new Date(item.status_updated_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).toLowerCase() : '-'}</p>
                  {item.attendance_finalized_at && (
                    <div style={{ margin: '8px 0', padding: 10, borderRadius: 10, border: '1px solid #d6f0dc', background: '#f2fbf4' }}>
                      <p style={{ margin: '2px 0', color: '#2f7a47', fontWeight: 700 }}>Final attendance submitted</p>
                      <p style={{ margin: '2px 0' }}>Children: {item.final_child_count ?? 0}</p>
                      <p style={{ margin: '2px 0' }}>Adults: {item.final_adult_count ?? 0}</p>
                      <p style={{ margin: '2px 0', fontWeight: 700 }}>Total: {item.final_total_count ?? ((item.final_child_count ?? 0) + (item.final_adult_count ?? 0))}</p>
                    </div>
                  )}
                  <p style={{ margin: '6px 0', color: item.status === 'confirmed' ? '#2f7a47' : item.status === 'cancelled' ? '#8a3f6b' : '#87631d', fontWeight: 600 }}>
                    Status: {item.status === 'confirmed' ? 'Party scheduled' : item.status === 'early_access_hold' ? 'Early access hold' : item.status === 'cancelled' ? 'Cancelled' : cancellationRequested ? 'Pending cancel' : isUpcoming ? 'Pending confirmation' : 'Pending (past date)'}
                  </p>
                  {item.status === 'confirmed' && <p style={{ margin: '6px 0', color: '#2f7a47', fontWeight: 700 }}>Deposit paid</p>}
                  {item.status === 'early_access_hold' && <p style={{ margin: '6px 0', color: '#87631d', fontWeight: 700 }}>Deposit not collected yet</p>}
                  {item.status !== 'cancelled' && isUpcoming && !cancellationRequested && (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button onClick={() => requestCancel(item.id)} disabled={requestingCancelId === item.id}>
                        {requestingCancelId === item.id ? 'Requesting...' : 'Request to cancel'}
                      </button>
                      {(() => {
                        const daysLeft = (new Date(item.start_time).getTime() - Date.now()) / 86_400_000;
                        const alreadyRescheduled = (item.notes ?? '').includes('[Rescheduled once');
                        const unavailable = alreadyRescheduled || daysLeft < 7;
                        if (unavailable) return <button disabled>Reschedule unavailable</button>;
                        return (
                          <button onClick={() => setRescheduleBookingId(item.id)}>
                            Reschedule (available once)
                          </button>
                        );
                      })()}
                    </div>
                  )}
                  {rescheduleBookingId === item.id && (
                    <div style={{ marginTop: 10, border: '1px solid #eadfff', borderRadius: 10, padding: 10 }}>
                      <label>
                        New date
                        <br />
                        <input style={{ width: '100%' }} type="date" value={rescheduleDate} onChange={(e) => setRescheduleDate(e.target.value)} />
                      </label>
                      <label style={{ marginLeft: 10 }}>
                        New time
                        <br />
                        <select style={{ width: '100%' }} value={rescheduleSlot} onChange={(e) => setRescheduleSlot(e.target.value as '11:00' | '15:00')}>
                          <option value="11:00">11:00 AM</option>
                          <option value="15:00">3:00 PM</option>
                        </select>
                      </label>
                      <div style={{ marginTop: 8 }}>
                        <button onClick={() => reschedule(item.id)}>Confirm reschedule</button>{' '}
                        <button onClick={() => setRescheduleBookingId(null)}>Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        </details>
      </section>

      <p style={{ marginTop: 20 }}>
        <Link href="/landing" style={{ display: 'inline-flex', border: '1px solid #d9c8f7', borderRadius: 12, padding: '10px 14px', color: '#5f3da4', textDecoration: 'none', fontWeight: 700 }}>
          ← Back to my dashboard
        </Link>
      </p>
    <style jsx>{`
  .mobileSlots { display:none; }
  .desktopCalendar { display:block; }
  @media (max-width: 900px) {
    .mobileSlots { display:block; }
    .desktopCalendar { display:none; }
  }
`}</style>
    </main>
  );
}
