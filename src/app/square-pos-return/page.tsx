'use client';

import { useEffect, useState } from 'react';
import { squarePosCallback } from '@/lib/admission-pos-ui';

export default function SquarePosReturnPage() {
  const [attempt, setAttempt] = useState(0);
  const [message, setMessage] = useState('Returning to the staff desk…');
  const [needsApp, setNeedsApp] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setError(false);
    setNeedsApp(false);
    void (async () => {
      try {
        const callback = squarePosCallback(window.location.search);
        if (!callback) throw new Error('Square did not return payment details. Reopen the staff desk to check this payment.');
        const authResponse = await fetch('/api/auth/staff', { cache: 'no-store', credentials: 'same-origin', signal: controller.signal });
        const access = await authResponse.json();
        if (!authResponse.ok || !access.ok) throw new Error('Unable to check the staff session. Please retry.');
        if (!access.is_staff) {
          setNeedsApp(true);
          if (callback.status === 'ok' && callback.return_token) {
            setMessage('Checking the Square receipt…');
            const response = await fetch('/api/square/pos-return', { method: 'POST', headers: { 'content-type': 'application/json' },
              signal: controller.signal, body: JSON.stringify({ state: callback.return_token, transaction_id: callback.transaction_id }) });
            const result = await response.json();
            if (!response.ok || !result.ok || result.status !== 'paid') throw new Error('Payment verification is pending. Reopen your staff app to retry; do not charge again.');
            setMessage('Square payment confirmed and saved. Reopen your Little Wanderers staff app from its Home Screen icon — the admission status will refresh automatically.');
          } else setMessage('Reopen your Little Wanderers staff app from its Home Screen icon. It will check Square and refresh this payment automatically.');
          return;
        }
        const target = new URL('/staff/checkin', window.location.origin);
        if (callback.status === 'ok') {
          setMessage('Checking the Square receipt…');
          const response = await fetch('/api/admin/admission/pos', { method: 'POST', headers: { 'content-type': 'application/json' },
            credentials: 'same-origin', signal: controller.signal,
            body: JSON.stringify({ mode: 'verify', state: callback.state, transaction_id: callback.transaction_id }) });
          const result = await response.json();
          if (!response.ok || !result.ok || result.status !== 'paid') throw new Error(result.error || 'Payment verification is pending. Reopen the staff desk to retry; do not charge again.');
          if (result.household_id) target.searchParams.set('family', result.household_id);
          target.searchParams.set('square_pos_return', 'verified');
        } else target.searchParams.set('square_pos_return', 'interrupted');
        if (!controller.signal.aborted) window.location.replace(target.pathname + target.search);
      } catch (error) {
        if (!controller.signal.aborted) { setError(true); setMessage(error instanceof Error ? error.message : 'Unable to return to staff desk.'); }
      }
    })();
    return () => controller.abort();
  }, [attempt]);
  return <main style={{ maxWidth: 620, margin: '8vh auto', padding: 24, color: '#4f3f82' }}>
    <h1>{needsApp ? 'Return to your staff app' : 'Return to staff desk'}</h1>
    <p role={error ? 'alert' : 'status'} style={{ fontSize: 18, lineHeight: 1.6 }}>{message}</p>
    {needsApp && <p>For automatic return to the staff desk after future payments, open the staff desk directly in Safari before starting Square.</p>}
    {error && <button type="button" onClick={() => setAttempt(value => value + 1)} style={{ padding: '14px 20px' }}>Retry receipt verification</button>}
    {(needsApp || error) && <p><a href="/staff/checkin">Open staff desk in this browser</a></p>}
  </main>;
}
