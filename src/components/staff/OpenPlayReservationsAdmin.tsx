'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

type Slot = {
  id: string;
  label: string;
  starts_at: string;
  ends_at: string;
  capacity_children: number;
  capacity_total: number | null;
  status: 'open' | 'hidden' | 'closed';
  notes: string | null;
};

type Reservation = {
  id: string;
  slot_id: string;
  household_id: string;
  contact_email: string | null;
  child_count: number;
  adult_count: number;
  notes: string | null;
  status: 'reserved' | 'cancelled' | 'checked_in' | 'no_show';
  created_at: string;
  household_name: string | null;
  household_email: string | null;
  household_phone: string | null;
  people: string[];
  slot?: Slot | null;
};

type AdminResponse = {
  ok?: boolean;
  error?: string;
  slots?: Slot[];
  reservations?: Reservation[];
};

const inputStyle = {
  width: '100%',
  boxSizing: 'border-box' as const,
  border: '1px solid #d8c5f6',
  borderRadius: 12,
  padding: '11px 12px',
  color: '#4f3f82',
  background: '#fff',
};

function toDatetimeLocal(date: Date) {
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function defaultStart() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(10, 0, 0, 0);
  return toDatetimeLocal(date);
}

function defaultEnd() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(12, 0, 0, 0);
  return toDatetimeLocal(date);
}

function formatRange(startIso: string, endIso: string) {
  const start = new Date(startIso);
  const end = new Date(endIso);
  return `${start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}, ${start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase()}-${end.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase()}`;
}

function statusColor(status: Reservation['status']) {
  if (status === 'reserved') return '#2f7a47';
  if (status === 'checked_in') return '#5f3da4';
  if (status === 'no_show') return '#87631d';
  return '#8a3f6b';
}

export default function OpenPlayReservationsAdmin() {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    label: 'Soft Opening Open Play',
    starts_at: defaultStart(),
    ends_at: defaultEnd(),
    capacity_children: '8',
    capacity_total: '',
    status: 'open',
    notes: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/admin/open-play-reservations', { cache: 'no-store' });
    const json = (await res.json().catch(() => ({}))) as AdminResponse;
    if (!res.ok || !json.ok) {
      setMessage(json.error ?? 'Could not load Open Play reservations.');
      setSlots([]);
      setReservations([]);
      setLoading(false);
      return;
    }

    setSlots(json.slots ?? []);
    setReservations(json.reservations ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const reservationsBySlot = useMemo(() => {
    const map = new Map<string, Reservation[]>();
    reservations.forEach((reservation) => {
      const list = map.get(reservation.slot_id) ?? [];
      list.push(reservation);
      map.set(reservation.slot_id, list);
    });
    return map;
  }, [reservations]);

  const activeReservations = reservations.filter((item) => item.status !== 'cancelled');
  const totals = activeReservations.reduce(
    (total, item) => ({
      reservations: total.reservations + 1,
      children: total.children + Number(item.child_count ?? 0),
      adults: total.adults + Number(item.adult_count ?? 0),
      total: total.total + Number(item.child_count ?? 0) + Number(item.adult_count ?? 0),
    }),
    { reservations: 0, children: 0, adults: 0, total: 0 }
  );

  const createSlot = async () => {
    setSubmitting(true);
    setMessage(null);

    const res = await fetch('/api/admin/open-play-reservations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        label: form.label,
        starts_at: new Date(form.starts_at).toISOString(),
        ends_at: new Date(form.ends_at).toISOString(),
        capacity_children: Number(form.capacity_children),
        capacity_total: form.capacity_total ? Number(form.capacity_total) : null,
        status: form.status,
        notes: form.notes,
      }),
    });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };

    if (!res.ok || !json.ok) {
      setMessage(json.error ?? 'Could not create visit window.');
      setSubmitting(false);
      return;
    }

    setMessage('Visit window created.');
    setSubmitting(false);
    await load();
  };

  const updateReservation = async (reservationId: string, status: Reservation['status']) => {
    setSubmitting(true);
    setMessage(null);

    const res = await fetch(`/api/admin/open-play-reservations/${reservationId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };

    if (!res.ok || !json.ok) {
      setMessage(json.error ?? 'Could not update reservation.');
      setSubmitting(false);
      return;
    }

    setMessage(`Reservation marked ${status.replace('_', ' ')}.`);
    setSubmitting(false);
    await load();
  };

  return (
    <div style={{ display: 'grid', gap: 18, marginTop: 20 }}>
      {message && (
        <p style={{ margin: 0, borderRadius: 14, border: '1px solid #eadfff', background: '#fffdf9', color: '#5f3da4', padding: 12, fontWeight: 800 }}>
          {message}
        </p>
      )}

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 12 }}>
        {[
          ['Active reservations', totals.reservations],
          ['Children expected', totals.children],
          ['Adults expected', totals.adults],
          ['Total guests', totals.total],
        ].map(([label, value]) => (
          <article key={label} style={{ border: '1px solid #e8dfef', borderRadius: 16, background: '#fffdf9', padding: 16 }}>
            <p style={{ margin: 0, color: '#7a63a5', fontWeight: 800, fontSize: 12, textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</p>
            <strong style={{ display: 'block', marginTop: 8, color: '#4f3f82', fontSize: 28 }}>{value}</strong>
          </article>
        ))}
      </section>

      <section style={{ border: '1px solid #dfccfb', borderRadius: 18, background: '#faf7ff', padding: 16 }}>
        <h2 style={{ margin: 0, color: '#4f3f82' }}>Create Open Play window</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 12, marginTop: 14 }}>
          <label style={{ display: 'grid', gap: 6, color: '#4f3f82', fontWeight: 700 }}>
            Label
            <input style={inputStyle} value={form.label} onChange={(event) => setForm((prev) => ({ ...prev, label: event.target.value }))} />
          </label>
          <label style={{ display: 'grid', gap: 6, color: '#4f3f82', fontWeight: 700 }}>
            Starts
            <input style={inputStyle} type="datetime-local" value={form.starts_at} onChange={(event) => setForm((prev) => ({ ...prev, starts_at: event.target.value }))} />
          </label>
          <label style={{ display: 'grid', gap: 6, color: '#4f3f82', fontWeight: 700 }}>
            Ends
            <input style={inputStyle} type="datetime-local" value={form.ends_at} onChange={(event) => setForm((prev) => ({ ...prev, ends_at: event.target.value }))} />
          </label>
          <label style={{ display: 'grid', gap: 6, color: '#4f3f82', fontWeight: 700 }}>
            Child capacity
            <input style={inputStyle} type="number" min={1} value={form.capacity_children} onChange={(event) => setForm((prev) => ({ ...prev, capacity_children: event.target.value }))} />
          </label>
          <label style={{ display: 'grid', gap: 6, color: '#4f3f82', fontWeight: 700 }}>
            Total capacity
            <input style={inputStyle} type="number" min={1} placeholder="Optional" value={form.capacity_total} onChange={(event) => setForm((prev) => ({ ...prev, capacity_total: event.target.value }))} />
          </label>
          <label style={{ display: 'grid', gap: 6, color: '#4f3f82', fontWeight: 700 }}>
            Status
            <select style={inputStyle} value={form.status} onChange={(event) => setForm((prev) => ({ ...prev, status: event.target.value }))}>
              <option value="open">Open</option>
              <option value="hidden">Hidden</option>
              <option value="closed">Closed</option>
            </select>
          </label>
        </div>
        <label style={{ display: 'grid', gap: 6, color: '#4f3f82', fontWeight: 700, marginTop: 12 }}>
          Notes
          <textarea style={{ ...inputStyle, resize: 'vertical' }} rows={2} value={form.notes} onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))} />
        </label>
        <button type="button" onClick={createSlot} disabled={submitting} style={{ marginTop: 14, width: '100%', minHeight: 48, border: 'none', borderRadius: 999, background: '#A78BCB', color: '#fff', fontWeight: 900 }}>
          {submitting ? 'Saving...' : 'Create visit window'}
        </button>
      </section>

      <section style={{ display: 'grid', gap: 12 }}>
        <h2 style={{ margin: 0, color: '#4f3f82' }}>Visit windows</h2>
        {loading ? (
          <p style={{ color: '#6d6480' }}>Loading...</p>
        ) : slots.length === 0 ? (
          <article style={{ border: '1px solid #f0d89b', borderRadius: 16, background: '#fff8e6', padding: 16 }}>
            <strong style={{ color: '#6b4d12' }}>No Open Play windows yet.</strong>
            <p style={{ margin: '8px 0 0', color: '#6d6480' }}>Create a soft opening visit window above, then Wanderlist families can reserve it.</p>
          </article>
        ) : slots.map((slot) => {
          const slotReservations = reservationsBySlot.get(slot.id) ?? [];
          const active = slotReservations.filter((reservation) => reservation.status !== 'cancelled');
          const children = active.reduce((sum, item) => sum + Number(item.child_count ?? 0), 0);
          const adults = active.reduce((sum, item) => sum + Number(item.adult_count ?? 0), 0);

          return (
            <article key={slot.id} style={{ border: '1px solid #e8dfef', borderRadius: 18, background: '#fffdf9', padding: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <p style={{ margin: 0, color: '#7a63a5', fontWeight: 900 }}>{slot.label}</p>
                  <h3 style={{ margin: '6px 0 0', color: '#4f3f82' }}>{formatRange(slot.starts_at, slot.ends_at)}</h3>
                  {slot.notes && <p style={{ margin: '8px 0 0', color: '#6d6480' }}>{slot.notes}</p>}
                </div>
                <div style={{ textAlign: 'right', color: '#6d6480' }}>
                  <strong style={{ display: 'block', color: '#4f3f82' }}>{children}/{slot.capacity_children} children</strong>
                  <span>{adults} adults · {slot.status}</span>
                </div>
              </div>

              <div style={{ display: 'grid', gap: 10, marginTop: 14 }}>
                {slotReservations.length === 0 ? (
                  <p style={{ margin: 0, color: '#6d6480' }}>No reservations for this window yet.</p>
                ) : slotReservations.map((reservation) => (
                  <div key={reservation.id} style={{ border: '1px solid #eadfff', borderRadius: 14, background: '#fff', padding: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                      <div>
                        <strong style={{ color: '#4f3f82' }}>{reservation.household_name ?? reservation.contact_email ?? 'Household'}</strong>
                        <p style={{ margin: '6px 0 0', color: '#6d6480' }}>
                          {reservation.child_count} child{reservation.child_count === 1 ? '' : 'ren'} · {reservation.adult_count} adult{reservation.adult_count === 1 ? '' : 's'}
                        </p>
                        <p style={{ margin: '4px 0 0', color: '#6d6480' }}>
                          {reservation.contact_email ?? reservation.household_email ?? 'No email'}{reservation.household_phone ? ` · ${reservation.household_phone}` : ''}
                        </p>
                      </div>
                      <span style={{ color: statusColor(reservation.status), fontWeight: 900, textTransform: 'capitalize' }}>{reservation.status.replace('_', ' ')}</span>
                    </div>
                    {reservation.people.length > 0 && <p style={{ margin: '8px 0 0', color: '#6d6480' }}>People: {reservation.people.join(', ')}</p>}
                    {reservation.notes && <p style={{ margin: '8px 0 0', color: '#6d6480' }}>Notes: {reservation.notes}</p>}
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                      {(['reserved', 'checked_in', 'no_show', 'cancelled'] as const).map((status) => (
                        <button key={status} type="button" onClick={() => updateReservation(reservation.id, status)} disabled={submitting || reservation.status === status} style={{ border: '1px solid #d9c8f7', borderRadius: 999, background: reservation.status === status ? '#f3ebff' : '#fff', color: status === 'cancelled' ? '#8a3f6b' : '#5f3da4', padding: '8px 12px', fontWeight: 800 }}>
                          {status.replace('_', ' ')}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </article>
          );
        })}
      </section>
    </div>
  );
}
