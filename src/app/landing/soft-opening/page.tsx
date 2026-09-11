'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { WAITLIST_JOIN_URL } from '@/lib/waitlist';

type AccessResponse = {
  ok?: boolean;
  allowed?: boolean;
  email?: string | null;
  error?: string;
  access?: {
    on_wanderlist?: boolean;
    party_early_access?: boolean;
    has_party_booking?: boolean;
  };
};

const softOpeningWindows = [
  {
    label: 'Weekday morning',
    detail: 'A gentle first visit window for babies, toddlers, and caregivers.',
    status: 'Times coming soon',
  },
  {
    label: 'Weekday afternoon',
    detail: 'A small-group play window while our team practices the daily flow.',
    status: 'Times coming soon',
  },
  {
    label: 'Weekend preview',
    detail: 'Limited family preview times before regular Open Play begins.',
    status: 'Times coming soon',
  },
];

function AccessBadge({ children }: { children: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', borderRadius: 999, background: '#f7efff', border: '1px solid #dfccfb', color: '#5f3da4', padding: '6px 10px', fontSize: 13, fontWeight: 800 }}>
      {children}
    </span>
  );
}

export default function SoftOpeningReservationPage() {
  const [access, setAccess] = useState<AccessResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedWindow, setSelectedWindow] = useState('Weekday morning');
  const [childrenCount, setChildrenCount] = useState('1');
  const [adultCount, setAdultCount] = useState('1');

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const res = await fetch('/api/soft-opening/access', { cache: 'no-store' });
      const json = (await res.json().catch(() => ({}))) as AccessResponse;
      setAccess({ ...json, ok: res.ok && json.ok !== false });
      setLoading(false);
    };

    void load();
  }, []);

  const accessLabels = useMemo(() => {
    const labels: string[] = [];
    if (access?.access?.on_wanderlist) labels.push('Wanderlist');
    if (access?.access?.party_early_access || access?.access?.has_party_booking) labels.push('Party early access');
    return [...new Set(labels)];
  }, [access]);

  if (loading) {
    return (
      <main style={{ padding: 24, maxWidth: 980, margin: '0 auto 88px' }}>
        <section style={{ border: '1px solid #e8dfef', borderRadius: 24, background: '#fffdf9', padding: 22 }}>
          <p style={{ margin: 0, color: '#6d6480' }}>Checking soft opening access...</p>
        </section>
      </main>
    );
  }

  if (!access?.allowed) {
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
          {access?.error && <p style={{ margin: '12px 0 0', color: '#8a3f6b' }}>{access.error}</p>}
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
              We are getting ready to welcome a small number of Wanderlist families before we open to the public.
              Choose a preferred visit window here once soft opening times are finalized.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {accessLabels.length > 0 ? accessLabels.map((label) => <AccessBadge key={label}>{label}</AccessBadge>) : <AccessBadge>Early access</AccessBadge>}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 12 }}>
          {softOpeningWindows.map((slot) => {
            const selected = selectedWindow === slot.label;
            return (
              <button
                key={slot.label}
                type="button"
                onClick={() => setSelectedWindow(slot.label)}
                style={{
                  minHeight: 152,
                  textAlign: 'left',
                  border: selected ? '2px solid #A78BCB' : '1px solid #eadfff',
                  borderRadius: 18,
                  background: selected ? '#fbf8ff' : '#fff',
                  padding: 16,
                  cursor: 'pointer',
                  boxShadow: selected ? '0 12px 24px rgba(125,103,156,.14)' : 'none',
                }}
              >
                <strong style={{ display: 'block', color: '#4f3f82', fontSize: 18 }}>{slot.label}</strong>
                <p style={{ margin: '8px 0 14px', color: '#6d6480', lineHeight: 1.5 }}>{slot.detail}</p>
                <span style={{ display: 'inline-flex', borderRadius: 999, background: '#fff8e6', border: '1px solid #f0d89b', color: '#7f4a04', padding: '5px 9px', fontSize: 12, fontWeight: 800 }}>
                  {slot.status}
                </span>
              </button>
            );
          })}
        </div>

        <section style={{ display: 'grid', gap: 14, border: '1px solid #dfccfb', borderRadius: 18, background: '#faf7ff', padding: 16 }}>
          <div>
            <h2 style={{ margin: 0, color: '#4f3f82', fontSize: 22 }}>Visit details</h2>
            <p style={{ margin: '6px 0 0', color: '#6d6480', lineHeight: 1.55 }}>
              This keeps the reservation form ready while we finalize dates, capacity, and visit windows.
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 12 }}>
            <label style={{ display: 'grid', gap: 6, color: '#4f3f82', fontWeight: 700 }}>
              Preferred window
              <input value={selectedWindow} readOnly style={{ width: '100%', boxSizing: 'border-box', border: '1px solid #d8c5f6', borderRadius: 12, padding: '12px 14px', color: '#4f3f82', background: '#fff' }} />
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
            <textarea rows={3} placeholder="Anything we should know before your soft opening visit?" style={{ width: '100%', boxSizing: 'border-box', border: '1px solid #d8c5f6', borderRadius: 12, padding: '12px 14px', color: '#4f3f82', background: '#fff', resize: 'vertical' }} />
          </label>

          <button type="button" disabled style={{ width: '100%', minHeight: 52, border: 'none', borderRadius: 999, background: '#cfc6dc', color: '#fff', fontWeight: 900, cursor: 'not-allowed' }}>
            Reservations opening soon
          </button>
        </section>

        <div style={{ display: 'grid', gap: 8, color: '#6d6480', lineHeight: 1.55, fontSize: 14 }}>
          <p style={{ margin: 0 }}>
            Signed in as <strong style={{ color: '#4f3f82' }}>{access.email}</strong>.
          </p>
          <p style={{ margin: 0 }}>
            Soft opening admission will be limited by occupancy and safety needs, and visit times may shift as final opening preparations come together.
          </p>
        </div>
      </section>
    </main>
  );
}
