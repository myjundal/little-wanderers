'use client';

import { useCallback, useEffect, useState } from 'react';
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

function toLocalInputValue(date: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(
    date.getMinutes()
  )}`;
}

export default function PartyPage() {
  const [items, setItems] = useState<PartyBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [bookedSlots, setBookedSlots] = useState<{ id: string; start_time: string; end_time: string }[]>([]);
  const [requestingCancelId, setRequestingCancelId] = useState<string | null>(null);

  const defaultStart = new Date();
  defaultStart.setDate(defaultStart.getDate() + 7);
  defaultStart.setHours(10, 0, 0, 0);

  const defaultEnd = new Date(defaultStart);
  defaultEnd.setHours(defaultEnd.getHours() + 2);

  const [form, setForm] = useState({
    start_time: toLocalInputValue(defaultStart),
    end_time: toLocalInputValue(defaultEnd),
    headcount_expected: '',
    notes: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/party-bookings', { cache: 'no-store' });
    const json = await res.json();

    if (!res.ok || !json.ok) {
      setMessage(json.error ?? 'Could not load party bookings.');
      setLoading(false);
      return;
    }

    setItems((json.items ?? []) as PartyBooking[]);

    const calendarRes = await fetch('/api/party-bookings/calendar', { cache: 'no-store' });
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

  const submit = async () => {
    setSubmitting(true);
    setMessage(null);

    const res = await fetch('/api/party-bookings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        start_time: new Date(form.start_time).toISOString(),
        end_time: new Date(form.end_time).toISOString(),
        headcount_expected: form.headcount_expected ? Number(form.headcount_expected) : null,
        notes: form.notes || null,
      }),
    });

    const json = await res.json();
    if (!res.ok || !json.ok) {
      setMessage(json.error ?? 'Request failed. Please try again.');
      setSubmitting(false);
      return;
    }

    setMessage('Your party booking request has been submitted.');
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
      label: 'My request',
      status: 'mine' as const,
    })),
  ];

  return (
    <main style={{ padding: 24, maxWidth: 860, margin: '0 auto', background: 'linear-gradient(180deg,#fff,#f7efff)', border: '1px solid #e3d0fb', borderRadius: 28, boxShadow: '0 18px 30px rgba(120,87,177,0.12)' }}>
      <h1 style={{ fontSize: 28, fontWeight: 800, color: '#4f3f82' }}>🎉 My Party Bookings</h1>
      <p style={{ color: '#6f628d', marginTop: 8 }}>Pick your dreamy party time, request booking, and manage cancellations from one cute dashboard.</p>

      {message && <p style={{ marginTop: 12 }}>{message}</p>}

      <AvailabilityCalendar
        title="Party booking calendar"
        slots={slots}
      />

      <section style={{ marginTop: 16, border: '1px solid #dfccfb', borderRadius: 14, background: '#fff', padding: 14 }}>
        <h3 style={{ marginTop: 0, color: '#4f3f82' }}>🪐 New party booking request</h3>

        <div style={{ display: 'grid', gap: 10 }}>
          <label>
            Start time
            <br />
            <input
              type="datetime-local"
              value={form.start_time}
              onChange={(e) => setForm({ ...form, start_time: e.target.value })}
            />
          </label>

          <label>
            End time
            <br />
            <input
              type="datetime-local"
              value={form.end_time}
              onChange={(e) => setForm({ ...form, end_time: e.target.value })}
            />
          </label>

          <label>
            Expected guests (optional)
            <br />
            <input
              type="number"
              min={1}
              value={form.headcount_expected}
              onChange={(e) => setForm({ ...form, headcount_expected: e.target.value })}
            />
          </label>

          <label>
            Notes (optional)
            <br />
            <textarea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </label>

          <button onClick={submit} disabled={submitting}>
            {submitting ? 'Submitting...' : 'Submit Party Request'}
          </button>
        </div>
      </section>

      <section style={{ marginTop: 22 }}>
        <h3 style={{ color: '#4f3f82' }}>📒 My current booking/history</h3>
        {loading ? (
          <p>Loading…</p>
        ) : items.length === 0 ? (
          <p>You do not have any party booking requests yet.</p>
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
                    Quoted price:{' '}
                    {item.price_quote_cents == null ? '-' : `$${(item.price_quote_cents / 100).toFixed(2)}`}
                  </p>
                  <p style={{ margin: '6px 0', color: '#555' }}>Notes: {item.notes ?? '-'}</p>
                  <p style={{ margin: '6px 0', color: '#6a6082' }}>Last updated: {item.status_updated_at ? new Date(item.status_updated_at).toLocaleString() : '-'}</p>
                  <p style={{ margin: '6px 0', color: item.status === 'confirmed' ? '#2f7a47' : item.status === 'cancelled' ? '#8a3f6b' : '#87631d', fontWeight: 600 }}>
                    Status: {item.status === 'confirmed' ? 'Confirmed' : item.status === 'cancelled' ? 'Cancelled' : cancellationRequested ? 'Pending · cancellation requested' : isUpcoming ? 'Pending confirmation' : 'Pending (past date)'}
                  </p>
                  {item.status !== 'cancelled' && isUpcoming && !cancellationRequested && (
                    <button onClick={() => requestCancel(item.id)} disabled={requestingCancelId === item.id}>
                      {requestingCancelId === item.id ? 'Requesting...' : 'Request to cancel'}
                    </button>
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
