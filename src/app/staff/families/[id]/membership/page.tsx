'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

export default function StaffFamilyMembershipPage({ params }: { params: { id: string } }) {
  const familyId = params.id;
  const searchParams = useSearchParams();
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (searchParams.get('membership_checkout') !== 'success') return;

    const finalize = async () => {
      setBusy(true);
      const res = await fetch(`/api/admin/families/${familyId}/membership`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'finalize_start' }),
      });
      const json = await res.json();
      setMessage(json.ok ? 'Membership started successfully.' : json.error ?? 'Could not finalize membership start.');
      setBusy(false);
      window.history.replaceState({}, '', `/staff/families/${familyId}/membership`);
    };

    void finalize();
  }, [familyId, searchParams]);

  const startMembership = async () => {
    setBusy(true);
    const res = await fetch(`/api/admin/families/${familyId}/membership`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'create_payment_link' }),
    });
    const json = await res.json();
    setBusy(false);

    if (!res.ok || !json.ok || !json.url) {
      setMessage(json.error ?? 'Could not start membership payment flow.');
      return;
    }

    window.location.assign(json.url);
  };

  const perform = async (action: 'pause' | 'end') => {
    setBusy(true);
    const res = await fetch(`/api/admin/families/${familyId}/membership`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    const json = await res.json();
    setBusy(false);
    setMessage(json.ok ? `Membership ${action} completed.` : json.error ?? `Membership ${action} failed.`);
  };

  return (
    <main style={{ padding: 24, maxWidth: 780, margin: '0 auto' }}>
      <p style={{ marginTop: 0 }}><Link href={`/staff/families/${familyId}`}>← Back to family detail</Link></p>
      <h1 style={{ color: '#4f3f82' }}>Manage membership</h1>
      <p style={{ color: '#6d6480' }}>Start membership goes through Square payment. Pause and end are staff manual actions.</p>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button type="button" onClick={startMembership} disabled={busy}>Start membership</button>
        <button type="button" onClick={() => perform('pause')} disabled={busy}>Pause membership</button>
        <button type="button" onClick={() => perform('end')} disabled={busy}>End membership</button>
      </div>

      {message && <p style={{ marginTop: 14, color: '#5f3da4' }}>{message}</p>}
    </main>
  );
}
