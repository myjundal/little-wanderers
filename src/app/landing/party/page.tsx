'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

type PartyBooking = {
  id: string;
  start_time: string;
  end_time: string;
  headcount_expected: number | null;
  price_quote_cents: number | null;
  notes: string | null;
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
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
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

  return (
    <main style={{ padding: 24, maxWidth: 860, margin: '0 auto' }}>
      <h1 style={{ fontSize: 24, fontWeight: 600 }}>My Party Bookings</h1>
      <p style={{ color: '#555', marginTop: 8 }}>Pick your preferred time and send a party booking request.</p>

      <section style={{ marginTop: 16, border: '1px solid #ddd', borderRadius: 12, padding: 14 }}>
        <h3 style={{ marginTop: 0 }}>New party booking request</h3>

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

      {message && <p style={{ marginTop: 12 }}>{message}</p>}

      <section style={{ marginTop: 22 }}>
        <h3>My request history</h3>
        {loading ? (
          <p>Loading…</p>
        ) : items.length === 0 ? (
          <p>You do not have any party booking requests yet.</p>
        ) : (
          <div style={{ display: 'grid', gap: 12 }}>
            {items.map((item) => (
              <div key={item.id} style={{ border: '1px solid #e2e2e2', borderRadius: 10, padding: 12 }}>
                <p style={{ margin: 0, fontWeight: 600 }}>
                  {new Date(item.start_time).toLocaleString()} ~ {new Date(item.end_time).toLocaleString()}
                </p>
                <p style={{ margin: '6px 0' }}>Expected guests: {item.headcount_expected ?? '-'}</p>
                <p style={{ margin: '6px 0' }}>
                  Quoted price:{' '}
                  {item.price_quote_cents == null ? '-' : `$${(item.price_quote_cents / 100).toFixed(2)}`}
                </p>
                <p style={{ margin: '6px 0', color: '#555' }}>Notes: {item.notes ?? '-'}</p>
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
