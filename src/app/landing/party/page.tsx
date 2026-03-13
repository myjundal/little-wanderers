'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

type PartyBooking = {
  id: string;
  start_time: string;
  end_time: string;
  room: string | null;
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
    room: '',
    headcount_expected: '',
    notes: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/party-bookings', { cache: 'no-store' });
    const json = await res.json();

    if (!res.ok || !json.ok) {
      setMessage(json.error ?? '파티 예약 목록을 불러오지 못했습니다.');
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
        room: form.room || null,
        headcount_expected: form.headcount_expected ? Number(form.headcount_expected) : null,
        notes: form.notes || null,
      }),
    });

    const json = await res.json();
    if (!res.ok || !json.ok) {
      setMessage(json.error ?? '예약 요청에 실패했습니다.');
      setSubmitting(false);
      return;
    }

    setMessage('파티 예약 요청이 등록되었습니다!');
    setSubmitting(false);
    await load();
  };

  return (
    <main style={{ padding: 24, maxWidth: 860, margin: '0 auto' }}>
      <h1 style={{ fontSize: 24, fontWeight: 600 }}>My Party Bookings</h1>
      <p style={{ color: '#555', marginTop: 8 }}>원하는 시간대를 선택해 파티 예약 요청을 보낼 수 있어요.</p>

      <section style={{ marginTop: 16, border: '1px solid #ddd', borderRadius: 12, padding: 14 }}>
        <h3 style={{ marginTop: 0 }}>새 파티 예약 요청</h3>

        <div style={{ display: 'grid', gap: 10 }}>
          <label>
            시작 시간
            <br />
            <input
              type="datetime-local"
              value={form.start_time}
              onChange={(e) => setForm({ ...form, start_time: e.target.value })}
            />
          </label>

          <label>
            종료 시간
            <br />
            <input
              type="datetime-local"
              value={form.end_time}
              onChange={(e) => setForm({ ...form, end_time: e.target.value })}
            />
          </label>

          <label>
            Room (optional)
            <br />
            <input value={form.room} onChange={(e) => setForm({ ...form, room: e.target.value })} />
          </label>

          <label>
            예상 인원 (optional)
            <br />
            <input
              type="number"
              min={1}
              value={form.headcount_expected}
              onChange={(e) => setForm({ ...form, headcount_expected: e.target.value })}
            />
          </label>

          <label>
            요청 메모 (optional)
            <br />
            <textarea
              rows={3}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </label>

          <button onClick={submit} disabled={submitting}>
            {submitting ? '요청 중...' : '파티 예약 요청하기'}
          </button>
        </div>
      </section>

      {message && <p style={{ marginTop: 12 }}>{message}</p>}

      <section style={{ marginTop: 22 }}>
        <h3>내 예약 요청 내역</h3>
        {loading ? (
          <p>Loading…</p>
        ) : items.length === 0 ? (
          <p>아직 파티 예약 요청이 없습니다.</p>
        ) : (
          <div style={{ display: 'grid', gap: 12 }}>
            {items.map((item) => (
              <div key={item.id} style={{ border: '1px solid #e2e2e2', borderRadius: 10, padding: 12 }}>
                <p style={{ margin: 0, fontWeight: 600 }}>
                  {new Date(item.start_time).toLocaleString()} ~ {new Date(item.end_time).toLocaleString()}
                </p>
                <p style={{ margin: '6px 0' }}>Room: {item.room ?? '-'}</p>
                <p style={{ margin: '6px 0' }}>Expected headcount: {item.headcount_expected ?? '-'}</p>
                <p style={{ margin: '6px 0' }}>Quoted price: {item.price_quote_cents == null ? '-' : `$${(item.price_quote_cents / 100).toFixed(2)}`}</p>
                <p style={{ margin: '6px 0', color: '#555' }}>Notes: {item.notes ?? '-'}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      <p style={{ marginTop: 20 }}>
        <Link href="/landing">← Back to App Home</Link>
      </p>
    </main>
  );
}
