'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import AvailabilityCalendar, { type CalendarSlot } from '@/components/calendar/AvailabilityCalendar';
import { WAITLIST_JOIN_URL } from '@/lib/waitlist';

type Slot = {
  id: string;
  label: string;
  starts_at: string;
  ends_at: string;
  capacity_children: number;
  capacity_total: number | null;
  status: 'open' | 'hidden' | 'closed';
  notes: string | null;
  occupancy?: {
    children: number;
    adults: number;
    total: number;
  };
  remaining_children: number;
  remaining_total: number | null;
  is_closed: boolean;
  is_full: boolean;
  reserved_by_household: boolean;
};

type Reservation = {
  id: string;
  slot_id: string;
  child_count: number;
  adult_count: number;
  notes: string | null;
  status: 'reserved' | 'cancelled' | 'checked_in' | 'no_show';
  created_at: string;
  slot?: Slot | null;
};

type ReservationResponse = {
  ok?: boolean;
  allowed?: boolean;
  error?: string;
  access?: {
    email?: string | null;
    on_wanderlist?: boolean;
    party_early_access?: boolean;
    has_party_booking?: boolean;
  };
  slots?: Slot[];
  reservations?: Reservation[];
};

function formatVisitRange(startIso: string, endIso: string) {
  const start = new Date(startIso);
  const end = new Date(endIso);
  return `${start.toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric' })}, ${start.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }).toLowerCase()}-${end.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }).toLowerCase()}`;
}

function formatWindow(startIso: string, endIso: string) {
  const start = new Date(startIso);
  const end = new Date(endIso);
  return `${start.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric' }).toLowerCase()}-${end.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric' }).toLowerCase()}`;
}

function AccessBadge({ children }: { children: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', borderRadius: 999, background: '#f7efff', border: '1px solid #dfccfb', color: '#5f3da4', padding: '6px 10px', fontSize: 13, fontWeight: 800 }}>
      {children}
    </span>
  );
}

export default function SoftOpeningReservationPage() {
  const [data, setData] = useState<ReservationResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [selectedSlotId, setSelectedSlotId] = useState('');
  const [childrenCount, setChildrenCount] = useState('1');
  const [adultCount, setAdultCount] = useState('1');
  const [notes, setNotes] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/open-play-reservations', { cache: 'no-store' });
    const json = (await res.json().catch(() => ({}))) as ReservationResponse;
    setData({ ...json, ok: res.ok && json.ok !== false });
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const slots = useMemo(() => data?.slots ?? [], [data?.slots]);
  const reservations = useMemo(() => data?.reservations ?? [], [data?.reservations]);
  const activeReservations = useMemo(() => reservations.filter((item) => item.status !== 'cancelled'), [reservations]);
  const selectedSlot = slots.find((slot) => slot.id === selectedSlotId && !slot.is_closed && !slot.is_full) ?? slots.find((slot) => !slot.is_closed && !slot.is_full && !slot.reserved_by_household) ?? null;
  const activeReservation = activeReservations[0] ?? null;
  const calendarSlots = useMemo<CalendarSlot[]>(() => slots.map((slot) => ({
    id: slot.id,
    start: slot.starts_at,
    end: slot.ends_at,
    label: slot.is_closed
        ? `${formatWindow(slot.starts_at, slot.ends_at)} closed`
        : slot.reserved_by_household
      ? `${formatWindow(slot.starts_at, slot.ends_at)} mine`
        : slot.is_full
        ? `${formatWindow(slot.starts_at, slot.ends_at)} taken`
        : formatWindow(slot.starts_at, slot.ends_at),
    status: slot.is_closed ? 'closed' : slot.reserved_by_household ? 'mine' : slot.is_full ? 'full' : 'available',
  })), [slots]);

  useEffect(() => {
    if (!selectedSlotId && selectedSlot?.id) setSelectedSlotId(selectedSlot.id);
  }, [selectedSlot?.id, selectedSlotId]);

  const accessLabels = useMemo(() => {
    const labels: string[] = [];
    if (data?.access?.on_wanderlist) labels.push('Wanderlist');
    if (data?.access?.party_early_access || data?.access?.has_party_booking) labels.push('Party early access');
    return [...new Set(labels)];
  }, [data]);

  const reserve = async () => {
    if (!selectedSlot) return;
    setSubmitting(true);
    setMessage(null);

    const res = await fetch('/api/open-play-reservations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        slot_id: selectedSlot.id,
        child_count: Number(childrenCount),
        adult_count: Number(adultCount),
        notes,
      }),
    });

    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok || !json.ok) {
      setMessage(json.error ?? 'Could not save your reservation.');
      setSubmitting(false);
      return;
    }

    setMessage('Your soft opening visit is reserved.');
    setNotes('');
    setSubmitting(false);
    await load();
  };

  const cancelReservation = async (reservationId: string) => {
    setSubmitting(true);
    setMessage(null);

    const res = await fetch(`/api/open-play-reservations/${reservationId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'cancel' }),
    });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };

    if (!res.ok || !json.ok) {
      setMessage(json.error ?? 'Could not cancel this reservation.');
      setSubmitting(false);
      return;
    }

    setMessage('Your reservation has been cancelled.');
    setSubmitting(false);
    await load();
  };

  if (loading) {
    return (
      <main style={{ padding: 24, maxWidth: 980, margin: '0 auto 88px' }}>
        <section style={{ border: '1px solid #e8dfef', borderRadius: 24, background: '#fffdf9', padding: 22 }}>
          <p style={{ margin: 0, color: '#6d6480' }}>Checking soft opening reservations...</p>
        </section>
      </main>
    );
  }

  if (!data?.ok || data.allowed === false) {
    return (
      <main style={{ padding: 24, maxWidth: 980, margin: '0 auto 88px' }}>
        <section style={{ border: '1px solid #f0d89b', borderRadius: 24, background: '#fff8e6', padding: 22 }}>
          <p style={{ margin: 0, color: '#7f4a04', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.04em', fontSize: 12 }}>
            Private access
          </p>
          <h1 style={{ margin: '8px 0 10px', color: '#4f3f82', fontSize: 'clamp(2rem,5vw,3.5rem)', lineHeight: 1.05 }}>
            Wanderlist Soft Opening
          </h1>
          <p style={{ margin: 0, color: '#6d6480', lineHeight: 1.7, maxWidth: 680 }}>
            This page is reserved for Wanderlist families and birthday party early access families. Please sign in with
            the same email you used for the Wanderlist or party request.
          </p>
          {data?.error && <p style={{ margin: '12px 0 0', color: '#8a3f6b' }}>{data.error}</p>}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 18 }}>
            <Link href="/login" style={{ display: 'inline-flex', justifyContent: 'center', alignItems: 'center', minHeight: 48, padding: '10px 20px', borderRadius: 999, background: '#A78BCB', color: '#fff', fontWeight: 800, textDecoration: 'none' }}>
              Sign in again
            </Link>
            <Link href={WAITLIST_JOIN_URL} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', justifyContent: 'center', alignItems: 'center', minHeight: 48, padding: '10px 20px', borderRadius: 999, border: '1px solid #CFC0E2', color: '#7a63a5', fontWeight: 800, textDecoration: 'none' }}>
              Join the Wanderlist
            </Link>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main style={{ padding: '16px clamp(12px,4vw,24px)', maxWidth: 1120, margin: '0 auto 88px' }}>
      <section style={{ display: 'grid', gap: 18, border: '1px solid #e8dfef', borderRadius: 28, background: '#fffdf9', boxShadow: '0 18px 34px rgba(158,143,191,.12)', padding: 'clamp(20px,4vw,34px)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div style={{ maxWidth: 720 }}>
            <p style={{ margin: 0, color: '#7a63a5', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.06em', fontSize: 12 }}>
              Private Wanderlist access
            </p>
            <h1 style={{ margin: '8px 0 10px', color: '#4f3f82', fontSize: 'clamp(2.1rem,5vw,4rem)', lineHeight: 1.02 }}>
              Soft Opening Visit
            </h1>
            <p style={{ margin: 0, color: '#5f5570', fontSize: 'clamp(1rem,2vw,1.16rem)', lineHeight: 1.7 }}>
              Choose a soft opening Open Play time before Little Wanderers opens to the public. Reservations are limited
              so the space stays comfortable while our team practices the daily flow.
            </p>
            <p style={{ margin: '10px 0 0', color: '#5f5570', fontSize: 'clamp(1rem,2vw,1.16rem)', lineHeight: 1.7 }}>
              The window you choose helps us manage capacity, but it is not a strict arrival or departure time. For example,
              if you reserve 9:00-11:00, you can arrive any time during that window and stay later while capacity allows.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {accessLabels.length > 0 ? accessLabels.map((label) => <AccessBadge key={label}>{label}</AccessBadge>) : <AccessBadge>Early access</AccessBadge>}
          </div>
        </div>

        {message && (
          <p style={{ margin: 0, borderRadius: 14, border: '1px solid #d6f0dc', background: '#f2fbf4', color: '#2f7a47', padding: 12, fontWeight: 800 }}>
            {message}
          </p>
        )}

        {activeReservation && activeReservation.slot && (
          <section style={{ border: '1px solid #d6f0dc', borderRadius: 18, background: '#f2fbf4', padding: 16 }}>
            <p style={{ margin: 0, color: '#2f7a47', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '.04em', fontSize: 12 }}>
              Reserved
            </p>
            <h2 style={{ margin: '8px 0 6px', color: '#4f3f82', fontSize: 22 }}>{formatVisitRange(activeReservation.slot.starts_at, activeReservation.slot.ends_at)}</h2>
            <p style={{ margin: 0, color: '#6d6480', lineHeight: 1.55 }}>
              {activeReservation.child_count} child{activeReservation.child_count === 1 ? '' : 'ren'} and {activeReservation.adult_count} adult{activeReservation.adult_count === 1 ? '' : 's'}.
            </p>
            {activeReservation.slot.status === 'closed' && (
              <p style={{ margin: '8px 0 0', color: '#8a3f6b', lineHeight: 1.55, fontWeight: 800 }}>
                This visit window is currently closed. We will follow up if your reservation needs to change.
              </p>
            )}
            <button type="button" onClick={() => cancelReservation(activeReservation.id)} disabled={submitting} style={{ marginTop: 14, border: '1px solid #d9c8f7', borderRadius: 999, background: '#fff', color: '#8a3f6b', padding: '10px 18px', fontWeight: 900 }}>
              {submitting ? 'Cancelling...' : 'Cancel reservation'}
            </button>
          </section>
        )}

        {slots.length === 0 ? (
            <article style={{ gridColumn: '1 / -1', border: '1px solid #f0d89b', borderRadius: 18, background: '#fff8e6', padding: 16 }}>
              <strong style={{ display: 'block', color: '#6b4d12' }}>Times coming soon</strong>
              <p style={{ margin: '8px 0 0', color: '#6d6480', lineHeight: 1.55 }}>
                Soft opening reservation times will appear here once they are released.
              </p>
            </article>
        ) : (
          <AvailabilityCalendar
            title="Soft opening calendar"
            subtitle="October 15-31, 2026. Choose one 2-hour arrival window: 9-11, 11-1, 1-3, or 3-5."
            slots={calendarSlots}
            onSlotSelect={(slot) => setSelectedSlotId(slot.id)}
            initialMonth="2026-10"
            maxVisibleSlotsPerDay={4}
            formatSlotPillLabel={(slot) => slot.label}
          />
        )}

        <section style={{ border: '1px solid #eadfff', borderRadius: 16, background: '#faf7ff', padding: 16 }}>
          <strong style={{ display: 'block', color: '#4f3f82' }}>About the visit window</strong>
          <p style={{ margin: '8px 0 0', color: '#6d6480', lineHeight: 1.55 }}>
            Arrive during your selected 2-hour window, then stay and play at an easy pace. This is our test period, so
            service may be slower or a little imperfect while we learn. Your encouragement will mean a lot to us.
          </p>
        </section>

        {!activeReservation && selectedSlot && (
          <section style={{ display: 'grid', gap: 14, border: '1px solid #dfccfb', borderRadius: 18, background: '#faf7ff', padding: 16 }}>
            <div>
              <h2 style={{ margin: 0, color: '#4f3f82', fontSize: 22 }}>Reserve this visit</h2>
              <p style={{ margin: '6px 0 0', color: '#6d6480', lineHeight: 1.55 }}>
                {formatVisitRange(selectedSlot.starts_at, selectedSlot.ends_at)}
              </p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 12 }}>
              <label style={{ display: 'grid', gap: 6, color: '#4f3f82', fontWeight: 700 }}>
                Window
                <select value={selectedSlot.id} onChange={(event) => setSelectedSlotId(event.target.value)} style={{ width: '100%', boxSizing: 'border-box', border: '1px solid #d8c5f6', borderRadius: 12, padding: '12px 14px', color: '#4f3f82', background: '#fff' }}>
                  {slots.map((slot) => (
                    <option key={slot.id} value={slot.id} disabled={slot.is_closed || slot.is_full || slot.reserved_by_household}>
                      {formatVisitRange(slot.starts_at, slot.ends_at)} {slot.is_closed ? '(closed)' : slot.is_full ? '(taken)' : `(${slot.remaining_children} child spots left)`}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ display: 'grid', gap: 6, color: '#4f3f82', fontWeight: 700 }}>
                Children
                <input type="number" min={1} max={6} value={childrenCount} onChange={(event) => setChildrenCount(event.target.value)} style={{ width: '100%', boxSizing: 'border-box', border: '1px solid #d8c5f6', borderRadius: 12, padding: '12px 14px', color: '#4f3f82', background: '#fff' }} />
              </label>
              <label style={{ display: 'grid', gap: 6, color: '#4f3f82', fontWeight: 700 }}>
                Adults
                <input type="number" min={1} max={2} value={adultCount} onChange={(event) => setAdultCount(event.target.value)} style={{ width: '100%', boxSizing: 'border-box', border: '1px solid #d8c5f6', borderRadius: 12, padding: '12px 14px', color: '#4f3f82', background: '#fff' }} />
              </label>
            </div>

            <label style={{ display: 'grid', gap: 6, color: '#4f3f82', fontWeight: 700 }}>
              Notes
              <textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Anything we should know before your soft opening visit?" style={{ width: '100%', boxSizing: 'border-box', border: '1px solid #d8c5f6', borderRadius: 12, padding: '12px 14px', color: '#4f3f82', background: '#fff', resize: 'vertical' }} />
            </label>

            <button type="button" onClick={reserve} disabled={submitting} style={{ width: '100%', minHeight: 52, border: 'none', borderRadius: 999, background: '#A78BCB', color: '#fff', fontWeight: 900 }}>
              {submitting ? 'Saving...' : 'Reserve soft opening visit'}
            </button>
          </section>
        )}

        <p style={{ margin: 0, color: '#6d6480', lineHeight: 1.55, fontSize: 14 }}>
          Soft opening admission is limited by occupancy and safety needs. If plans change, please cancel your reservation
          so another family can use the spot.
        </p>
        <p style={{ margin: 0, color: '#6d6480', lineHeight: 1.55, fontSize: 14 }}>
          Your selected window is an arrival window, not a checkout time. {selectedSlot ? `For ${formatWindow(selectedSlot.starts_at, selectedSlot.ends_at)}, you can arrive during that window and stay longer as capacity allows.` : 'You can arrive during your reserved window and stay longer as capacity allows.'}
        </p>
      </section>
    </main>
  );
}
