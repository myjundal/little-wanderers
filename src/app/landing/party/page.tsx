'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import AvailabilityCalendar, { type CalendarSlot } from '@/components/calendar/AvailabilityCalendar';

type PartyBooking = {
  id: string;
  start_time: string;
  end_time: string;
  headcount_expected: number | null;
  price_quote_cents: number | null;
  notes: string | null;
  status: 'pending' | 'confirmed' | 'cancelled';
  status_updated_at: string | null;
  created_at: string;
};

const PARTY_DEPOSIT_DOLLARS = 150;

function toIsoUtc(date: string, hourUtc: number) {
  return new Date(`${date}T${String(hourUtc).padStart(2, '0')}:00:00`).toISOString();
}

function getDefaultWeekendDate() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  for (let i = 0; i < 14; i += 1) {
    const day = d.getUTCDay();
    if (day === 0 || day === 6) return d.toISOString().slice(0, 10);
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return new Date().toISOString().slice(0, 10);
}

function isWeekendDate(date: string) {
  const d = new Date(`${date}T00:00:00.000Z`);
  const day = d.getUTCDay();
  return day === 0 || day === 6;
}

export default function PartyPage() {
  const [items, setItems] = useState<PartyBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [bookedSlots, setBookedSlots] = useState<{ id: string; start_time: string; end_time: string }[]>([]);
  const [requestingCancelId, setRequestingCancelId] = useState<string | null>(null);
  const finalizingPaymentRef = useRef(false);
  const [rescheduleBookingId, setRescheduleBookingId] = useState<string | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState(getDefaultWeekendDate());
  const [rescheduleSlot, setRescheduleSlot] = useState<'11:00' | '15:00'>('11:00');

  const [form, setForm] = useState({
    party_date: getDefaultWeekendDate(),
    slot: '11:00',
    headcount_expected: '',
    notes: '',
  });

  const startIso = useMemo(() => toIsoUtc(form.party_date, form.slot === '15:00' ? 15 : 11), [form.party_date, form.slot]);
  const endIso = useMemo(() => toIsoUtc(form.party_date, form.slot === '15:00' ? 18 : 14), [form.party_date, form.slot]);

  const load = useCallback(async () => {
    setLoading(true);
    const requestKey = Date.now();
    const res = await fetch(`/api/party-bookings?ts=${requestKey}`, { cache: 'no-store' });
    const json = await res.json();

    if (!res.ok || !json.ok) {
      setMessage(json.error ?? 'Could not load party bookings.');
      setLoading(false);
      return;
    }

    setItems((json.items ?? []) as PartyBooking[]);

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
      const headcount = params.get('headcount_expected');
      const slot = params.get('slot');
    const notes = params.get('notes');
    if (!startTime || !endTime) return;

    const finalize = async () => {
      finalizingPaymentRef.current = true;
      setSubmitting(true);
      const res = await fetch('/api/party-bookings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mode: 'finalize',
          start_time: startTime,
          end_time: endTime,
          headcount_expected: headcount ? Number(headcount) : null,
          notes: notes || null,
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
    setSubmitting(true);
    setMessage(null);

    if (!isWeekendDate(form.party_date)) {
      setMessage('Please choose a Saturday or Sunday.');
      setSubmitting(false);
      return;
    }

    const res = await fetch('/api/party-bookings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        mode: 'create_payment_link',
        start_time: startIso,
        end_time: endIso,
        headcount_expected: form.headcount_expected ? Number(form.headcount_expected) : null,
        notes: form.notes || null,
        slot: form.slot,
      }),
    });

    const json = await res.json();
    if (!res.ok || !json.ok) {
      setMessage(json.error ?? 'Request failed. Please try again.');
      setSubmitting(false);
      return;
    }

    if (!json.payment_url) {
      setMessage('Payment URL was not returned.');
      setSubmitting(false);
      return;
    }

    window.location.assign(json.payment_url);
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
        const d = new Date(now);
        d.setDate(now.getDate() + i);
        const day = d.getDay();
        if (day !== 0 && day !== 6) continue;
        const dayStr = d.toISOString().slice(0, 10);
        const start11 = toIsoUtc(dayStr, 11);
        const start15 = toIsoUtc(dayStr, 15);
        const blockedStarts = new Set(
          [...bookedSlots, ...items.filter((item) => item.status !== 'cancelled')].map((item) => item.start_time)
        );
        if (!blockedStarts.has(start11)) {
          generated.push({
            id: `avail-${dayStr}-11`,
            start: start11,
            end: toIsoUtc(dayStr, 14),
            label: 'Available party slot',
            status: 'available',
          });
        }
        if (!blockedStarts.has(start15)) {
          generated.push({
            id: `avail-${dayStr}-15`,
            start: start15,
            end: toIsoUtc(dayStr, 18),
            label: 'Available party slot',
            status: 'available',
          });
        }
      }
      return generated;
    })(),
    ...bookedSlots.map((slot) => ({
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

  const reschedule = async (bookingId: string) => {
    const nextStart = toIsoUtc(rescheduleDate, rescheduleSlot === '15:00' ? 15 : 11);
    const nextEnd = toIsoUtc(rescheduleDate, rescheduleSlot === '15:00' ? 18 : 14);
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
    <main style={{ padding: 24, maxWidth: 860, margin: '0 auto', background: 'linear-gradient(180deg,#fff,#f7efff)', border: '1px solid #e3d0fb', borderRadius: 28, boxShadow: '0 18px 30px rgba(120,87,177,0.12)' }}>
      <h1 style={{ fontSize: 28, fontWeight: 800, color: '#4f3f82' }}>🎉 My Party Bookings</h1>
      <p style={{ color: '#6f628d', marginTop: 8 }}>Choose a weekend party slot, pay your deposit, and manage your booking from one dashboard.</p>

      {message && <p style={{ marginTop: 12 }}>{message}</p>}

      <AvailabilityCalendar title="Party booking calendar" slots={slots} />

      <section style={{ marginTop: 16, border: '1px solid #dfccfb', borderRadius: 14, background: '#fff', padding: 14 }}>
        <h3 style={{ marginTop: 0, color: '#4f3f82' }}>🪐 New party booking</h3>

        <div style={{ marginBottom: 14, padding: 12, borderRadius: 10, border: '1px solid #eadfff', background: '#faf5ff' }}>
          <strong>Please note:</strong>
          <ul style={{ margin: '8px 0 0 20px' }}>
            <li>50% of the party fee ($150) is required to reserve your party.</li>
            <li>The deposit is non-refundable.</li>
            <li>You may reschedule once, up to 7 days before your party date.</li>
            <li>Final headcount is due 3 days before the party.</li>
          </ul>
        </div>

        <div style={{ display: 'grid', gap: 10 }}>
          <label>
            Party date (Saturday or Sunday)
            <br />
            <input type="date" value={form.party_date} onChange={(e) => setForm((prev) => ({ ...prev, party_date: e.target.value }))} />
          </label>

          <label>
            Time
            <br />
            <select value={form.slot} onChange={(e) => setForm((prev) => ({ ...prev, slot: e.target.value }))}>
              <option value="11:00">11:00 AM (ends at 2:00 PM)</option>
              <option value="15:00">3:00 PM (ends at 6:00 PM)</option>
            </select>
          </label>

          <label>
            Expected guests (optional)
            <br />
            <input
              type="number"
              min={1}
              value={form.headcount_expected}
              onChange={(e) => setForm((prev) => ({ ...prev, headcount_expected: e.target.value }))}
            />
          </label>

          <label>
            Notes (optional)
            <br />
            <textarea rows={3} value={form.notes} onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))} />
          </label>

          <button onClick={submit} disabled={submitting}>
            {submitting ? 'Preparing payment...' : `Confirm party and pay $${PARTY_DEPOSIT_DOLLARS} deposit`}
          </button>
        </div>
      </section>

      <section style={{ marginTop: 22 }}>
        <h3 style={{ color: '#4f3f82' }}>📒 My current booking/history</h3>
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
                    {new Date(item.start_time).toLocaleString()} ~ {new Date(item.end_time).toLocaleString()}
                  </p>
                  <p style={{ margin: '6px 0' }}>Expected guests: {item.headcount_expected ?? '-'}</p>
                  <p style={{ margin: '6px 0' }}>
                    Party fee:{' '}
                    {item.price_quote_cents == null ? '-' : `$${(item.price_quote_cents / 100).toFixed(2)}`}
                  </p>
                  <p style={{ margin: '6px 0', color: '#555' }}>Notes: {item.notes ?? '-'}</p>
                  <p style={{ margin: '6px 0', color: '#6a6082' }}>Last updated: {item.status_updated_at ? new Date(item.status_updated_at).toLocaleString() : '-'}</p>
                  <p style={{ margin: '6px 0', color: item.status === 'confirmed' ? '#2f7a47' : item.status === 'cancelled' ? '#8a3f6b' : '#87631d', fontWeight: 600 }}>
                    Status: {item.status === 'confirmed' ? 'Party scheduled' : item.status === 'cancelled' ? 'Cancelled' : cancellationRequested ? 'Pending · cancellation requested' : isUpcoming ? 'Pending confirmation' : 'Pending (past date)'}
                  </p>
                  {item.status === 'confirmed' && <p style={{ margin: '6px 0', color: '#2f7a47', fontWeight: 700 }}>Deposit paid</p>}
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
                        <input type="date" value={rescheduleDate} onChange={(e) => setRescheduleDate(e.target.value)} />
                      </label>
                      <label style={{ marginLeft: 10 }}>
                        New time
                        <br />
                        <select value={rescheduleSlot} onChange={(e) => setRescheduleSlot(e.target.value as '11:00' | '15:00')}>
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
      </section>

      <p style={{ marginTop: 20 }}>
        <Link href="/landing">← Back to Homepage</Link>
      </p>
    </main>
  );
}
