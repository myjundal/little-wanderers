'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

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

export default function MyClassesPage() {
  const [items, setItems] = useState<RegistrationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setMessage(null);

    const res = await fetch('/api/classes/my', { cache: 'no-store' });
    const json = await res.json();

    if (!res.ok || !json.ok) {
      setMessage(json.error ?? 'Failed to load my classes.');
      setLoading(false);
      return;
    }

    setItems((json.items ?? []) as RegistrationItem[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

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
    <main style={{ padding: 24, maxWidth: 860, margin: '0 auto' }}>
      <h1 style={{ fontSize: 24, fontWeight: 600 }}>My Classes</h1>
      <p style={{ color: '#555', marginTop: 8 }}>See and manage your class bookings.</p>

      {message && <p style={{ marginTop: 12 }}>{message}</p>}

      <section style={{ marginTop: 16 }}>
        {loading ? (
          <p>Loading…</p>
        ) : items.length === 0 ? (
          <div style={{ border: '1px dashed #ccc', borderRadius: 12, padding: 16 }}>
            <p>You do not have any class bookings yet.</p>
            <Link href="/landing/classschedule">Browse class schedule →</Link>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 12 }}>
            {items.map((item) => (
              <div key={item.id} style={{ border: '1px solid #e2e2e2', borderRadius: 10, padding: 14 }}>
                <h3 style={{ margin: 0 }}>{item.class?.title ?? 'Removed class'}</h3>
                <p style={{ margin: '8px 0', color: '#666' }}>
                  Person: {item.person_name} · Status:{' '}
                  <b style={{ textTransform: 'uppercase' }}>{item.status}</b>
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
        <Link href="/landing/classschedule">← Back to Class Schedule</Link>
      </p>
      <p style={{ marginTop: 8 }}>
        <Link href="/landing">← Back to Homepage</Link>
      </p>
    </main>
  );
}
