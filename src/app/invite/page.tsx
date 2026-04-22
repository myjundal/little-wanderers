'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';

export default function InviteAcceptPage() {
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const token = useMemo(() => {
    if (typeof window === 'undefined') return '';
    const params = new URLSearchParams(window.location.search);
    return params.get('token') ?? '';
  }, []);

  const acceptInvite = async () => {
    setLoading(true);
    setError(null);
    setMessage(null);

    const res = await fetch('/api/family/invites/accept', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    });

    const json = await res.json();
    setLoading(false);

    if (!res.ok || !json.ok) {
      setError(json.error ?? 'Unable to accept this invite right now.');
      return;
    }

    setMessage('Welcome! You now have access to your family household.');
  };

  return (
    <main style={{ maxWidth: 640, margin: '0 auto', padding: 24 }}>
      <h1>Family Invite</h1>
      <p>Accept your invite to join your family’s Little Wanderers account.</p>

      {!token && <p style={{ color: '#8a3f6b' }}>Invite token is missing. Please open the full invite link from your email.</p>}

      <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
        <button
          type="button"
          onClick={acceptInvite}
          disabled={loading || !token}
          style={{ borderRadius: 999, border: 'none', background: '#6d4bb7', color: '#fff', padding: '10px 14px', fontWeight: 700 }}
        >
          {loading ? 'Accepting…' : 'Accept Invite'}
        </button>
        <Link href="/login" style={{ alignSelf: 'center' }}>Sign in</Link>
      </div>

      {message && <p style={{ color: '#2f7a44', marginTop: 12 }}>{message}</p>}
      {error && <p style={{ color: '#8a3f6b', marginTop: 12 }}>{error}</p>}
    </main>
  );
}
