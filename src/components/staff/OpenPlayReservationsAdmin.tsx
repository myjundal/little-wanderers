'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import AvailabilityCalendar, { type CalendarSlot } from '@/components/calendar/AvailabilityCalendar';

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

type SlotActionInput = {
  status: 'open' | 'closed';
  date?: string;
  start_date?: string;
  end_date?: string;
  starts_at?: string;
  ends_at?: string;
  window_start?: string;
  window_end?: string;
};

type UpdateScope = 'window' | 'day' | 'week' | 'range' | 'timeRange';

const SOFT_OPENING_START_DATE = '2026-10-15';
const SOFT_OPENING_END_DATE = '2026-10-31';

function ymd(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function easternYmd(iso: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(iso));

  const year = parts.find((part) => part.type === 'year')?.value ?? '2026';
  const month = parts.find((part) => part.type === 'month')?.value ?? '01';
  const day = parts.find((part) => part.type === 'day')?.value ?? '01';
  return `${year}-${month}-${day}`;
}

function easternTimeKey(iso: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(iso));

  const hour = parts.find((part) => part.type === 'hour')?.value ?? '00';
  const minute = parts.find((part) => part.type === 'minute')?.value ?? '00';
  return `${hour}:${minute}`;
}

function formatRange(startIso: string, endIso: string) {
  const start = new Date(startIso);
  const end = new Date(endIso);
  return `${start.toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric' })}, ${start.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }).toLowerCase()}-${end.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }).toLowerCase()}`;
}

function formatWindow(startIso: string, endIso: string) {
  const start = new Date(startIso);
  const end = new Date(endIso);
  return `${start.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric' }).toLowerCase()}-${end.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric' }).toLowerCase()}`;
}

function getWeekRange(dateKey: string) {
  const date = new Date(`${dateKey}T00:00:00`);
  const start = new Date(date);
  start.setDate(date.getDate() - date.getDay());
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { startDate: ymd(start), endDate: ymd(end) };
}

function statusColor(status: Reservation['status']) {
  if (status === 'reserved') return '#2f7a47';
  if (status === 'checked_in') return '#5f3da4';
  if (status === 'no_show') return '#87631d';
  return '#8a3f6b';
}

function reservationTotals(items: Reservation[]) {
  return items
    .filter((item) => item.status !== 'cancelled')
    .reduce(
      (total, item) => ({
        reservations: total.reservations + 1,
        children: total.children + Number(item.child_count ?? 0),
        adults: total.adults + Number(item.adult_count ?? 0),
        total: total.total + Number(item.child_count ?? 0) + Number(item.adult_count ?? 0),
      }),
      { reservations: 0, children: 0, adults: 0, total: 0 }
    );
}

export default function OpenPlayReservationsAdmin() {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [selectedDate, setSelectedDate] = useState(SOFT_OPENING_START_DATE);
  const [selectedSlotId, setSelectedSlotId] = useState('');
  const [rangeStart, setRangeStart] = useState(SOFT_OPENING_START_DATE);
  const [rangeEnd, setRangeEnd] = useState(SOFT_OPENING_END_DATE);
  const [updateScope, setUpdateScope] = useState<UpdateScope>('window');

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

  const selectedDaySlots = useMemo(
    () => slots.filter((slot) => easternYmd(slot.starts_at) === selectedDate),
    [selectedDate, slots]
  );
  const selectedSlot = slots.find((slot) => slot.id === selectedSlotId) ?? selectedDaySlots[0] ?? null;
  const selectedWeek = getWeekRange(selectedDate);

  const calendarSlots = useMemo<CalendarSlot[]>(() => slots.map((slot) => {
    const slotReservations = reservationsBySlot.get(slot.id) ?? [];
    const active = slotReservations.filter((reservation) => reservation.status !== 'cancelled');
    const childCount = active.reduce((sum, reservation) => sum + Number(reservation.child_count ?? 0), 0);
    const isFull = childCount >= Number(slot.capacity_children ?? 0);
    const slotStatus: CalendarSlot['status'] = slot.status === 'closed' || slot.status === 'hidden'
      ? 'closed'
      : isFull
        ? 'full'
        : active.length > 0
          ? 'booked'
          : 'available';

    return {
      id: slot.id,
      start: slot.starts_at,
      end: slot.ends_at,
      label: slot.status === 'closed' || slot.status === 'hidden'
        ? `${formatWindow(slot.starts_at, slot.ends_at)} closed`
        : `${formatWindow(slot.starts_at, slot.ends_at)} ${childCount}/${slot.capacity_children}`,
      status: slotStatus,
    };
  }), [reservationsBySlot, slots]);

  const selectedDayReservations = useMemo(() => reservations
    .filter((reservation) => selectedDaySlots.some((slot) => slot.id === reservation.slot_id))
    .sort((a, b) => new Date(a.slot?.starts_at ?? a.created_at).getTime() - new Date(b.slot?.starts_at ?? b.created_at).getTime()), [reservations, selectedDaySlots]);
  const selectedDayTotals = reservationTotals(selectedDayReservations);
  const allTotals = reservationTotals(reservations);

  useEffect(() => {
    if (!selectedSlotId && selectedSlot?.id) setSelectedSlotId(selectedSlot.id);
  }, [selectedSlot?.id, selectedSlotId]);

  const buildSlotAction = (status: 'open' | 'closed'): SlotActionInput | null => {
    if (updateScope === 'window') {
      if (!selectedSlot) return null;
      return { status, starts_at: selectedSlot.starts_at, ends_at: selectedSlot.ends_at };
    }

    if (updateScope === 'day') return { status, date: selectedDate };
    if (updateScope === 'week') return { status, start_date: selectedWeek.startDate, end_date: selectedWeek.endDate };
    if (updateScope === 'range') return { status, start_date: rangeStart, end_date: rangeEnd };
    if (!selectedSlot) return null;
    return {
      status,
      start_date: rangeStart,
      end_date: rangeEnd,
      window_start: easternTimeKey(selectedSlot.starts_at),
      window_end: easternTimeKey(selectedSlot.ends_at),
    };
  };

  const scopeSummary = () => {
    if (updateScope === 'window' && selectedSlot) return `${formatRange(selectedSlot.starts_at, selectedSlot.ends_at)}`;
    if (updateScope === 'day') return `All windows on ${selectedDate}`;
    if (updateScope === 'week') return `All windows from ${selectedWeek.startDate} to ${selectedWeek.endDate}`;
    if (updateScope === 'range') return `All windows from ${rangeStart} to ${rangeEnd}`;
    if (updateScope === 'timeRange' && selectedSlot) return `${formatWindow(selectedSlot.starts_at, selectedSlot.ends_at)} from ${rangeStart} to ${rangeEnd}`;
    return 'Choose a window first';
  };

  const updateSlots = async (status: 'open' | 'closed') => {
    const input = buildSlotAction(status);
    if (!input) {
      setMessage('Choose a window first.');
      return;
    }

    setSubmitting(true);
    setMessage(null);

    const res = await fetch('/api/admin/open-play-reservations', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'update_slots', ...input }),
    });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; updated_count?: number };

    if (!res.ok || !json.ok) {
      setMessage(json.error ?? 'Could not update windows.');
      setSubmitting(false);
      return;
    }

    setMessage(`${status === 'closed' ? 'Closed' : 'Reopened'} ${json.updated_count ?? 0} window${json.updated_count === 1 ? '' : 's'}.`);
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
          ['Active reservations', allTotals.reservations],
          ['Children expected', allTotals.children],
          ['Adults expected', allTotals.adults],
          ['Total guests', allTotals.total],
        ].map(([label, value]) => (
          <article key={label} style={{ border: '1px solid #e8dfef', borderRadius: 16, background: '#fffdf9', padding: 16 }}>
            <p style={{ margin: 0, color: '#7a63a5', fontWeight: 800, fontSize: 12, textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</p>
            <strong style={{ display: 'block', marginTop: 8, color: '#4f3f82', fontSize: 28 }}>{value}</strong>
          </article>
        ))}
      </section>

      {loading ? (
        <section style={{ border: '1px solid #e8dfef', borderRadius: 18, background: '#fffdf9', padding: 16 }}>
          <p style={{ margin: 0, color: '#6d6480' }}>Loading Open Play reservations...</p>
        </section>
      ) : slots.length === 0 ? (
        <section style={{ border: '1px solid #f0d89b', borderRadius: 18, background: '#fff8e6', padding: 16 }}>
          <strong style={{ color: '#6b4d12' }}>No soft opening windows yet.</strong>
          <p style={{ margin: '8px 0 0', color: '#6d6480' }}>Seed the October soft opening windows in Supabase first.</p>
        </section>
      ) : (
        <AvailabilityCalendar
          title="Open Play reservation calendar"
          subtitle="October soft opening windows. Click a pill to inspect the date below."
          slots={calendarSlots}
          onSlotSelect={(slot) => {
            setSelectedSlotId(slot.id);
            setSelectedDate(easternYmd(slot.start));
          }}
          selectableStatuses={['available', 'booked', 'full', 'closed']}
          initialMonth="2026-10"
          maxVisibleSlotsPerDay={4}
          formatSlotPillLabel={(slot) => slot.label}
        />
      )}

      <section style={{ border: '1px solid #dfccfb', borderRadius: 18, background: '#faf7ff', padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div>
            <h2 style={{ margin: 0, color: '#4f3f82' }}>Selected date</h2>
            <p style={{ margin: '6px 0 0', color: '#6d6480' }}>
              {selectedDate} · {selectedDayTotals.reservations} active reservation{selectedDayTotals.reservations === 1 ? '' : 's'} · {selectedDayTotals.children} children · {selectedDayTotals.adults} adults
            </p>
          </div>
          <input type="date" value={selectedDate} min={SOFT_OPENING_START_DATE} max={SOFT_OPENING_END_DATE} onChange={(event) => {
            setSelectedDate(event.target.value);
            setSelectedSlotId('');
          }} style={{ border: '1px solid #d8c5f6', borderRadius: 12, padding: '10px 12px', color: '#4f3f82', background: '#fff' }} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 10, marginTop: 14 }}>
          {selectedDaySlots.map((slot) => {
            const slotReservations = reservationsBySlot.get(slot.id) ?? [];
            const active = slotReservations.filter((reservation) => reservation.status !== 'cancelled');
            const children = active.reduce((sum, item) => sum + Number(item.child_count ?? 0), 0);
            const selected = selectedSlot?.id === slot.id;
            return (
              <button key={slot.id} type="button" onClick={() => setSelectedSlotId(slot.id)} style={{ minHeight: 90, textAlign: 'left', border: selected ? '2px solid #A78BCB' : '1px solid #eadfff', borderRadius: 14, background: selected ? '#fff' : '#fffdf9', padding: 12, color: '#4f3f82' }}>
                <strong style={{ display: 'block' }}>{formatWindow(slot.starts_at, slot.ends_at)}</strong>
                <span style={{ display: 'block', marginTop: 6, color: slot.status === 'closed' ? '#8a3f6b' : '#6d6480' }}>
                  {slot.status === 'closed' ? 'Closed' : `${children}/${slot.capacity_children} children`}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section style={{ display: 'grid', gap: 12 }}>
        <h2 style={{ margin: 0, color: '#4f3f82' }}>Reservations for {selectedDate}</h2>
        {selectedDayReservations.length === 0 ? (
          <article style={{ border: '1px solid #e8dfef', borderRadius: 16, background: '#fffdf9', padding: 16, color: '#6d6480' }}>
            No reservations or cancellations for this date yet.
          </article>
        ) : selectedDayReservations.map((reservation) => (
          <article key={reservation.id} style={{ border: '1px solid #e8dfef', borderRadius: 16, background: reservation.status === 'cancelled' ? '#fff8fb' : '#fffdf9', padding: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <p style={{ margin: 0, color: '#7a63a5', fontWeight: 900 }}>{reservation.slot ? formatRange(reservation.slot.starts_at, reservation.slot.ends_at) : 'Open Play reservation'}</p>
                <h3 style={{ margin: '6px 0 0', color: '#4f3f82' }}>{reservation.household_name ?? reservation.contact_email ?? 'Household'}</h3>
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
          </article>
        ))}
      </section>

      <section style={{ border: '1px solid #e8dfef', borderRadius: 18, background: '#fffdf9', padding: 16 }}>
        <h2 style={{ margin: 0, color: '#4f3f82' }}>Close or reopen windows</h2>
        <p style={{ margin: '6px 0 0', color: '#6d6480', lineHeight: 1.5 }}>
          Closing windows makes them unavailable on the family calendar. Existing reservations stay visible above.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))', gap: 12, marginTop: 14 }}>
          <label style={{ display: 'grid', gap: 6, color: '#4f3f82', fontWeight: 700 }}>
            Update
            <select value={updateScope} onChange={(event) => setUpdateScope(event.target.value as UpdateScope)} style={{ border: '1px solid #d8c5f6', borderRadius: 12, padding: '10px 12px', color: '#4f3f82', background: '#fff' }}>
              <option value="window">Selected window only</option>
              <option value="day">Selected day</option>
              <option value="week">Selected week</option>
              <option value="range">Date range</option>
              <option value="timeRange">Selected time across date range</option>
            </select>
          </label>

          {(updateScope === 'range' || updateScope === 'timeRange') && (
            <>
              <label style={{ display: 'grid', gap: 6, color: '#4f3f82', fontWeight: 700 }}>
                Range start
                <input type="date" min={SOFT_OPENING_START_DATE} max={SOFT_OPENING_END_DATE} value={rangeStart} onChange={(event) => setRangeStart(event.target.value)} style={{ border: '1px solid #d8c5f6', borderRadius: 12, padding: '10px 12px', color: '#4f3f82', background: '#fff' }} />
              </label>
              <label style={{ display: 'grid', gap: 6, color: '#4f3f82', fontWeight: 700 }}>
                Range end
                <input type="date" min={SOFT_OPENING_START_DATE} max={SOFT_OPENING_END_DATE} value={rangeEnd} onChange={(event) => setRangeEnd(event.target.value)} style={{ border: '1px solid #d8c5f6', borderRadius: 12, padding: '10px 12px', color: '#4f3f82', background: '#fff' }} />
              </label>
            </>
          )}
        </div>

        <div style={{ marginTop: 12, borderRadius: 14, border: '1px solid #eadfff', background: '#faf7ff', padding: 12 }}>
          <p style={{ margin: 0, color: '#6d6480', lineHeight: 1.5 }}>
            Target: <strong style={{ color: '#4f3f82' }}>{scopeSummary()}</strong>
          </p>
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 12 }}>
          <button type="button" disabled={submitting} onClick={() => updateSlots('closed')} style={{ border: '1px solid #e5bad1', borderRadius: 999, background: '#fff0fb', color: '#8a3f6b', padding: '11px 18px', fontWeight: 900 }}>
            Close target
          </button>
          <button type="button" disabled={submitting} onClick={() => updateSlots('open')} style={{ border: '1px solid #d9c8f7', borderRadius: 999, background: '#fff', color: '#5f3da4', padding: '11px 18px', fontWeight: 900 }}>
            Reopen target
          </button>
        </div>
      </section>
    </div>
  );
}
