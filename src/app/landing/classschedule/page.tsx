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
  duration_minutes: number | null;
  instructor_name: string | null;
  description: string | null;
  age_range: string | null;
  capacity: number | null;
  price_cents: number;
  booked_count: number;
  seats_left: number | null;
  is_popular: boolean;
  recommended_class_ids: string[];
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

type CartItemState = {
  class_id: string;
  quantity: number;
};

export default function ClassSchedulePage() {
  const supabase = createBrowserSupabaseClient();
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [myItems, setMyItems] = useState<RegistrationItem[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [selectedPersonId, setSelectedPersonId] = useState('');
  const [cartItems, setCartItems] = useState<CartItemState[]>([]);
  const [recentlyPaidRegistrationIds, setRecentlyPaidRegistrationIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [checkouting, setCheckouting] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [cartHydrated, setCartHydrated] = useState(false);
  const CART_STORAGE_KEY = 'lw_class_cart_v1';

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(CART_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as CartItemState[];
      const safe = (parsed ?? [])
        .filter((item) => item?.class_id)
        .map((item) => ({
          class_id: item.class_id,
          quantity: Number.isInteger(item.quantity) && item.quantity > 0 ? item.quantity : 1,
        }));
      setCartItems(safe);
    } catch {
      // ignore malformed saved cart
    }
    setCartHydrated(true);
  }, []);

  useEffect(() => {
    if (!cartHydrated) return;
    window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cartItems));
  }, [cartHydrated, cartItems]);

  const load = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    const requestKey = Date.now();

    const [classRes, myRes] = await Promise.all([
      fetch(`/api/classes?limit=200&ts=${requestKey}`, { cache: 'no-store' }),
      fetch(`/api/classes/my?ts=${requestKey}`, { cache: 'no-store' }),
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

    const loadedClasses = (classJson.items ?? []) as ClassItem[];
    setClasses(loadedClasses);
    setMyItems(myJson.items ?? []);
    setCartItems((prev) => prev.filter((item) => loadedClasses.some((loaded) => loaded.id === item.class_id)));

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
    const interval = window.setInterval(() => {
      load();
    }, 10000);

    return () => window.clearInterval(interval);
  }, [load]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const checkout = params.get('checkout');
    const personId = params.get('person_id');
    const itemsRaw = params.get('items');

    if (checkout !== 'success' || !personId) return;
    const safeItems = (itemsRaw
      ? decodeURIComponent(itemsRaw)
          .split(',')
          .map((token) => token.trim())
          .filter(Boolean)
          .map((token) => {
            const [classId, qtyRaw] = token.split(':');
            const qty = Number(qtyRaw);
            return {
              class_id: classId,
              quantity: Number.isInteger(qty) && qty > 0 ? qty : 1,
            };
          })
          .filter((item) => item.class_id)
      : cartItems
    );
    if (safeItems.length === 0) return;

    const finalize = async () => {
      setCheckouting(true);
      const res = await fetch('/api/classes/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'finalize', items: safeItems, person_id: personId }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setMessage(json.error ?? 'Could not finalize checkout after payment.');
        setCheckouting(false);
        return;
      }

      const total = Number(json.checkout_summary?.total_price_cents ?? 0);
      setMessage(`Payment complete and classes booked: ${safeItems.reduce((sum, item) => sum + item.quantity, 0)} seat(s), total $${(total / 100).toFixed(2)}.`);
      setRecentlyPaidRegistrationIds((json.checkout_summary?.registration_ids ?? []) as string[]);
      setCartItems([]);
      setCheckouting(false);
      await load();
      window.history.replaceState({}, '', '/landing/classschedule');
    };

    void finalize();
  }, [cartItems, load]);

  const classById = useMemo(() => new Map(classes.map((item) => [item.id, item])), [classes]);

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
        .filter((item) => item.class?.start_time && item.class?.status !== 'cancelled' && item.status !== 'cancelled')
        .map<CalendarSlot>((item) => ({
          id: `mine-${item.id}`,
          start: item.class!.start_time,
          end: item.class!.end_time,
          label: item.class?.title ?? 'My class',
          status: 'mine',
        })),
    ],
    [classes, myItems]
  );

  const cancelledItems = useMemo(
    () => myItems.filter((item) => item.status === 'cancelled' || item.class?.status === 'cancelled'),
    [myItems]
  );
  const activeItems = useMemo(
    () => myItems.filter((item) => item.status !== 'cancelled' && item.class?.status !== 'cancelled'),
    [myItems]
  );

  const cartClassDetails = useMemo(
    () =>
      cartItems
        .map((item) => ({ ...item, classInfo: classById.get(item.class_id) }))
        .filter((item): item is CartItemState & { classInfo: ClassItem } => Boolean(item.classInfo)),
    [cartItems, classById]
  );

  const cartTotalCents = useMemo(
    () => cartClassDetails.reduce((sum, item) => sum + item.classInfo.price_cents * item.quantity, 0),
    [cartClassDetails]
  );

  const recommendedForCart = useMemo(() => {
    const scores = new Map<string, number>();
    cartClassDetails.forEach((item) => {
      item.classInfo.recommended_class_ids.forEach((id, index) => {
        if (cartItems.some((cartItem) => cartItem.class_id === id)) return;
        const weight = Math.max(3 - index, 1);
        scores.set(id, (scores.get(id) ?? 0) + weight);
      });
    });

    return [...scores.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => classById.get(id))
      .filter((item): item is ClassItem => Boolean(item))
      .slice(0, 4);
  }, [cartClassDetails, cartItems, classById]);

  const addToCart = (classId: string) => {
    setCartItems((prev) => {
      const found = prev.find((item) => item.class_id === classId);
      if (found) return prev;
      return [...prev, { class_id: classId, quantity: 1 }];
    });
  };

  const updateCartQuantity = (classId: string, nextQty: number) => {
    if (nextQty <= 0) {
      setCartItems((prev) => prev.filter((item) => item.class_id !== classId));
      return;
    }
    setCartItems((prev) =>
      prev.map((item) => (item.class_id === classId ? { ...item, quantity: Math.max(nextQty, 1) } : item))
    );
  };

  const checkoutCart = async () => {
    if (!selectedPersonId || cartItems.length === 0) return;
    setCheckouting(true);
    setMessage(null);

    const res = await fetch('/api/classes/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'create_payment_link', items: cartItems, person_id: selectedPersonId }),
    });

    const json = await res.json();
    if (!res.ok || !json.ok) {
      setMessage(json.error ?? 'Checkout failed.');
      setCheckouting(false);
      return;
    }

    if (!json.payment_url) {
      setMessage('Payment URL was not returned.');
      setCheckouting(false);
      return;
    }
    window.location.assign(json.payment_url);
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

    setMessage('Paid class booking has been cancelled.');
    setCancellingId(null);
    await load();
  };

  return (
    <main style={{ padding: 24, maxWidth: 980, margin: '0 auto', background: 'linear-gradient(180deg,#fff,#f7efff)', border: '1px solid #e3d0fb', borderRadius: 28, boxShadow: '0 18px 30px rgba(120,87,177,0.12)' }}>
      <h1 style={{ fontSize: 34, fontWeight: 900, color: '#4f3f82', marginBottom: 4 }}>🛸 Class Adventures / Cart Checkout</h1>
      <p style={{ color: '#6f628d', marginTop: 8 }}>Add classes, edit your cart, and pay once with Square. You can also cancel booked classes.</p>

      <section style={{ marginTop: 16, padding: 12, border: '1px solid #dfccfb', borderRadius: 14, background: '#fff' }}>
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

      <AvailabilityCalendar title="Class calendar" slots={classSlots} />

      <section style={{ marginTop: 18, border: '1px solid #e1d2fb', borderRadius: 14, background: '#fff', padding: 14 }}>
        <h2 style={{ fontSize: 22, margin: '0 0 10px', color: '#4f3f82' }}>🛒 Cart</h2>
        {cartClassDetails.length === 0 ? (
          <p>Your cart is empty.</p>
        ) : (
          <>
            <div style={{ display: 'grid', gap: 10 }}>
              {cartClassDetails.map((item) => (
                <div key={item.class_id} style={{ border: '1px solid #e9dcfb', borderRadius: 10, padding: 10 }}>
                  <strong>{item.classInfo.title}</strong> · ${(item.classInfo.price_cents / 100).toFixed(2)} each
                  <div style={{ color: '#6d6480', marginTop: 4 }}>Seats left: {item.classInfo.seats_left == null ? 'Unlimited' : item.classInfo.seats_left}</div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
                    <button onClick={() => updateCartQuantity(item.class_id, item.quantity - 1)}>-</button>
                    <span>Qty: {item.quantity}</span>
                    <button onClick={() => updateCartQuantity(item.class_id, item.quantity + 1)}>+</button>
                    <button onClick={() => updateCartQuantity(item.class_id, 0)} style={{ marginLeft: 8 }}>Remove</button>
                  </div>
                </div>
              ))}
            </div>
            <p style={{ marginTop: 12, fontWeight: 700 }}>Total: ${(cartTotalCents / 100).toFixed(2)}</p>
            <button onClick={checkoutCart} disabled={!selectedPersonId || checkouting}>
              {checkouting ? 'Processing...' : 'Checkout all'}
            </button>
          </>
        )}

        {recommendedForCart.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <h3 style={{ margin: '0 0 8px' }}>Frequently bundled class picks</h3>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {recommendedForCart.map((item) => (
                <button key={item.id} onClick={() => addToCart(item.id)} style={{ borderRadius: 999, border: '1px solid #d7c5f8', background: '#f7f1ff', padding: '6px 10px' }}>
                  + {item.title}
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      <section style={{ marginTop: 18 }}>
        <h2 style={{ fontSize: 22, margin: '0 0 10px', color: '#4f3f82' }}>✨ Upcoming classes</h2>
        {loading ? (
          <p>Loading…</p>
        ) : classes.length === 0 ? (
          <p>No upcoming classes yet.</p>
        ) : (
          <div style={{ display: 'grid', gap: 12 }}>
            {classes.map((c) => {
              const isFull = c.seats_left != null && c.seats_left <= 0;
              const inCart = cartItems.some((item) => item.class_id === c.id);
              return (
                <div key={c.id} style={{ border: '1px solid #e3d4fa', borderRadius: 14, padding: 14, background: '#fff', boxShadow: '0 6px 16px rgba(138, 103, 193, 0.08)' }}>
                  <h3 style={{ margin: 0 }}>
                    {c.title}{' '}
                    {c.is_popular && (
                      <span style={{ fontSize: 12, padding: '3px 7px', borderRadius: 999, background: '#ffe4f1', color: '#9d2f65' }}>
                        Popular
                      </span>
                    )}
                  </h3>
                  <p style={{ margin: '8px 0', color: '#666' }}>
                    {new Date(c.start_time).toLocaleString()} ~ {new Date(c.end_time).toLocaleTimeString()}
                  </p>
                  <p style={{ margin: '6px 0' }}>Category: {c.category ?? '-'}</p>
                  <p style={{ margin: '6px 0' }}>Instructor: {c.instructor_name ?? '-'}</p>
                  <p style={{ margin: '6px 0' }}>Age(s): {c.age_range ?? '-'}</p>
                  <p style={{ margin: '6px 0' }}>Duration: {c.duration_minutes ?? Math.round((new Date(c.end_time).getTime() - new Date(c.start_time).getTime()) / 60000)} min</p>
                  <p style={{ margin: '6px 0' }}>Price: ${(c.price_cents / 100).toFixed(2)}</p>
                  <p style={{ margin: '6px 0' }}>
                    Seats: {c.capacity == null ? 'Unlimited' : `${c.booked_count}/${c.capacity}`}{' '}
                    {c.seats_left != null && `(Left: ${c.seats_left})`}
                  </p>
                  {c.description && <p style={{ margin: '6px 0', color: '#666' }}>{c.description}</p>}
                  <button onClick={() => addToCart(c.id)} disabled={isFull || inCart || !selectedPersonId}>
                    {inCart ? 'Added' : isFull ? 'Full' : 'Add to cart'}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section style={{ marginTop: 24 }}>
        <h2 style={{ fontSize: 22, margin: '0 0 10px', color: '#4f3f82' }}>🌙 Paid / booked classes</h2>
        {loading ? (
          <p>Loading…</p>
        ) : activeItems.length === 0 ? (
          <div style={{ border: '1px dashed #ccc', borderRadius: 12, padding: 16 }}>
            <p>You do not have any class bookings yet.</p>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 12 }}>
            {activeItems.map((item) => (
              <div key={item.id} style={{ border: '1px solid #e3d4fa', borderRadius: 14, padding: 14, background: '#fff', boxShadow: '0 6px 16px rgba(138, 103, 193, 0.08)' }}>
                <h3 style={{ margin: 0 }}>{item.class?.title ?? 'Removed class'}</h3>
                <p style={{ margin: '8px 0', color: '#666' }}>
                  Person: {item.person_name} · Status:{' '}
                  <b style={{ textTransform: 'uppercase' }}>
                    {item.class?.status === 'cancelled' ? 'studio_cancelled' : item.status}
                  </b>
                </p>
                {recentlyPaidRegistrationIds.includes(item.id) && (
                  <p style={{ margin: '6px 0', color: '#2f7a47', fontWeight: 700 }}>Payment completed</p>
                )}
                <p style={{ margin: '6px 0' }}>
                  Time: {item.class?.start_time ? new Date(item.class.start_time).toLocaleString() : '-'}
                </p>
                <p style={{ margin: '6px 0' }}>Category: {item.class?.category ?? '-'}</p>
                {item.class?.status === 'cancelled' && (
                  <p style={{ margin: '6px 0', color: '#8a3f6b', fontWeight: 600 }}>
                    This class was cancelled by the studio and has been removed from the customer calendar.
                  </p>
                )}
                {item.status !== 'cancelled' && item.class?.status !== 'cancelled' && (
                  <button onClick={() => cancelRegistration(item.id)} disabled={cancellingId === item.id}>
                    {cancellingId === item.id ? 'Cancelling...' : 'Cancel Booking'}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {cancelledItems.length > 0 && (
        <section style={{ marginTop: 20 }}>
          <h2 style={{ fontSize: 20, margin: '0 0 10px', color: '#8a3f6b' }}>Cancelled bookings</h2>
          <div style={{ display: 'grid', gap: 10 }}>
            {cancelledItems.map((item) => (
              <div key={`cancelled-${item.id}`} style={{ border: '1px dashed #d8b1d0', borderRadius: 12, padding: 12, background: '#fff7fc' }}>
                <strong>{item.class?.title ?? 'Removed class'}</strong>
                <p style={{ margin: '6px 0' }}>Person: {item.person_name}</p>
                <p style={{ margin: '6px 0' }}>Time: {item.class?.start_time ? new Date(item.class.start_time).toLocaleString() : '-'}</p>
                <p style={{ margin: '6px 0', color: '#8a3f6b', fontWeight: 700 }}>Cancelled</p>
              </div>
            ))}
          </div>
        </section>
      )}

      <p style={{ marginTop: 20 }}>
        <Link href="/landing">← Back to Homepage</Link>
      </p>
    </main>
  );
}
