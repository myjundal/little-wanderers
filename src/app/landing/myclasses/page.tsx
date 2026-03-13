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
      setMessage(json.error ?? 'Failed to load my classes');
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
      setMessage(json.error ?? '취소에 실패했습니다.');
      setCancellingId(null);
      return;
    }

    setMessage('예약을 취소했습니다.');
    setCancellingId(null);
    await load();
  };

  return (
    <main style={{ padding: 24, maxWidth: 860, margin: '0 auto' }}>
      <h1 style={{ fontSize: 24, fontWeight: 600 }}>My Classes</h1>
      <p style={{ color: '#555', marginTop: 8 }}>내가 예약한 클래스와 상태를 확인해요.</p>

      {message && <p style={{ marginTop: 12 }}>{message}</p>}

      <section style={{ marginTop: 16 }}>
        {loading ? (
          <p>Loading…</p>
        ) : items.length === 0 ? (
          <div style={{ border: '1px dashed #ccc', borderRadius: 12, padding: 16 }}>
            <p>아직 예약한 클래스가 없습니다.</p>
            <Link href="/landing/classschedule">클래스 보러 가기 →</Link>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 12 }}>
            {items.map((item) => (
              <div key={item.id} style={{ border: '1px solid #e2e2e2', borderRadius: 10, padding: 14 }}>
                <h3 style={{ margin: 0 }}>{item.class?.title ?? '삭제된 클래스'}</h3>
                <p style={{ margin: '8px 0', color: '#666' }}>
                  대상: {item.person_name} · 상태: <b style={{ textTransform: 'uppercase' }}>{item.status}</b>
                </p>
                <p style={{ margin: '6px 0' }}>
                  시간: {item.class?.start_time ? new Date(item.class.start_time).toLocaleString() : '-'}
                </p>
                <p style={{ margin: '6px 0' }}>카테고리: {item.class?.category ?? '-'}</p>
                {item.status !== 'cancelled' && (
                  <button onClick={() => cancelRegistration(item.id)} disabled={cancellingId === item.id}>
                    {cancellingId === item.id ? '취소 중...' : '예약 취소'}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <p style={{ marginTop: 20 }}>
        <Link href="/landing/classschedule">← Class Schedule</Link>
      </p>
    </main>
  );
}
