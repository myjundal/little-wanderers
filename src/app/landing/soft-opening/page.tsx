'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { WAITLIST_JOIN_URL } from '@/lib/waitlist';

type Slot = {
  id: string;
  label: string;
  starts_at: string;
  ends_at: string;
  capacity_children: number;
  capacity_total: number | null;
  notes: string | null;
  remaining_children: number;
  remaining_total: number | null;
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
  return `${start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}, ${start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase()}-${end.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase()}`;
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

  const slots = data?.slots ?? [];
  const reservations = data?.reservations ?? [];
  const activeReservations = reservations.filter((item) => item.status !== 'cancelled');
  const selectedSlot = slots.find((slot) => slot.id === selectedSlotId) ?? slots.find((slot) => !slot.is_full && !slot.reserved_by_household) ?? null;
  const activeReservation = activeReservations[0] ?? null;

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
            <button type="button" onClick={() => cancelReservation(activeReservation.id)} disabled={submitting} style={{ marginTop: 14, border: '1px solid #d9c8f7', borderRadius: 999, background: '#fff', color: '#8a3f6b', padding: '10px 18px', fontWeight: 900 }}>
              {submitting ? 'Cancelling...' : 'Cancel reservation'}
            </button>
          </section>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 12 }}>
          {slots.length === 0 ? (
            <article style={{ gridColumn: '1 / -1', border: '1px solid #f0d89b', borderRadius: 18, background: '#fff8e6', padding: 16 }}>
              <strong style={{ display: 'block', color: '#6b4d12' }}>Times coming soon</strong>
              <p style={{ margin: '8px 0 0', color: '#6d6480', lineHeight: 1.55 }}>
                Soft opening reservation times will appear here once they are released.
              </p>
            </article>
          ) : slots.map((slot) => {
            const selected = selectedSlot?.id === slot.id;
            const disabled = slot.is_full || slot.reserved_by_household || Boolean(activeReservation);
            return (
              <button
                key={slot.id}
                type="button"
                onClick={() => !disabled && setSelectedSlotId(slot.id)}
                disabled={disabled}
                style={{
                  minHeight: 170,
                  textAlign: 'left',
                  border: selected ? '2px solid #A78BCB' : '1px solid #eadfff',
                  borderRadius: 18,
                  background: selected ? '#fbf8ff' : '#fff',
                  padding: 16,
                  cursor: disabled ? 'not-allowed' : 'pointer',
                  opacity: disabled && !selected ? 0.62 : 1,
                  boxShadow: selected ? '0 12px 24px rgba(125,103,156,.14)' : 'none',
                }}
              >
                <strong style={{ display: 'block', color: '#4f3f82', fontSize: 18 }}>{slot.label}</strong>
                <p style={{ margin: '8px 0 10px', color: '#6d6480', lineHeight: 1.5 }}>{formatVisitRange(slot.starts_at, slot.ends_at)}</p>
                <span style={{ display: 'inline-flex', borderRadius: 999, background: slot.is_full ? '#fff0fb' : '#fff8e6', border: '1px solid #f0d89b', color: slot.is_full ? '#8a3f6b' : '#7f4a04', padding: '5px 9px', fontSize: 12, fontWeight: 800 }}>
                  {slot.reserved_by_household ? 'You reserved this' : slot.is_full ? 'Full' : `${slot.remaining_children} child spots left`}
                </span>
              </button>
            );
          })}
        </div>

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
      </section>
    </main>
  );
}
