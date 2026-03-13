'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createBrowserSupabaseClient } from '@/lib/supabase/browser';

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

export default function ClassSchedulePage() {
  const supabase = createBrowserSupabaseClient();
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [selectedPersonId, setSelectedPersonId] = useState('');
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [bookingClassId, setBookingClassId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setMessage(null);

    const classRes = await fetch('/api/classes', { cache: 'no-store' });
    const classJson = await classRes.json();
    if (!classRes.ok || !classJson.ok) {
      setMessage(classJson.error ?? 'Failed to load classes');
      setLoading(false);
      return;
    }

    setClasses(classJson.items ?? []);

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
    () =>
      new Map(people.map((p) => [p.id, `${p.first_name} ${p.last_name ?? ''}`.trim()])),
    [people]
  );

  const bookClass = async (classId: string) => {
    if (!selectedPersonId) {
      alert('먼저 예약할 사람을 선택해 주세요.');
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
      setMessage(json.error ?? '예약에 실패했습니다.');
      setBookingClassId(null);
      return;
    }

    setMessage(
      `${peopleNameMap.get(selectedPersonId) ?? '선택한 인원'} 예약 완료!`
    );
    setBookingClassId(null);
    await load();
  };

  return (
    <main style={{ padding: 24, maxWidth: 860, margin: '0 auto' }}>
      <h1 style={{ fontSize: 24, fontWeight: 600 }}>Class Schedule</h1>
      <p style={{ color: '#555', marginTop: 8 }}>다가오는 클래스에 바로 예약할 수 있어요.</p>

      <section style={{ marginTop: 16, padding: 12, border: '1px solid #ddd', borderRadius: 10 }}>
        <label style={{ display: 'block', marginBottom: 6, fontWeight: 500 }}>예약할 사람 선택</label>
        <select
          value={selectedPersonId}
          onChange={(e) => setSelectedPersonId(e.target.value)}
          style={{ minWidth: 280, padding: 6 }}
        >
          {people.length === 0 && <option value="">등록된 사람이 없습니다</option>}
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.first_name} {p.last_name ?? ''}
            </option>
          ))}
        </select>
      </section>

      {message && <p style={{ marginTop: 12, color: '#333' }}>{message}</p>}

      <section style={{ marginTop: 18 }}>
        {loading ? (
          <p>Loading…</p>
        ) : classes.length === 0 ? (
          <p>예정된 클래스가 아직 없습니다.</p>
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
                  <p style={{ margin: '6px 0' }}>카테고리: {c.category ?? '-'}</p>
                  <p style={{ margin: '6px 0' }}>가격: ${(c.price_cents / 100).toFixed(2)}</p>
                  <p style={{ margin: '6px 0' }}>
                    좌석: {c.capacity == null ? '무제한' : `${c.booked_count}/${c.capacity}`} {c.seats_left != null && `(남은 ${c.seats_left})`}
                  </p>
                  <button
                    onClick={() => bookClass(c.id)}
                    disabled={isFull || !selectedPersonId || bookingClassId === c.id}
                  >
                    {bookingClassId === c.id ? '예약 중...' : isFull ? '마감' : '예약하기'}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <p style={{ marginTop: 20 }}>
        <Link href="/landing/myclasses">내 클래스 예약 보기 →</Link>
      </p>
    </main>
  );
}
