'use client';

import { useSearchParams } from 'next/navigation';

export default function AuthLinkPage() {
  const searchParams = useSearchParams();
  const hasAuthToken = searchParams.has('code') || searchParams.has('token_hash');

  function finishSignIn() {
    const params = searchParams.toString();
    window.location.assign(params ? `/auth/callback?${params}` : '/login?error=missing-code');
  }

  return (
    <main style={{ padding: 16, maxWidth: 480, margin: '0 auto' }}>
      <section style={{ borderRadius: 24, border: '1px solid #e3d0fb', background: '#fff', boxShadow: '0 16px 28px rgba(120,87,177,0.12)', padding: 20 }}>
        <p style={{ margin: 0, color: '#7a63a5', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Little Wanderers</p>
        <h1 style={{ margin: '10px 0 8px', color: '#4f3f82', fontSize: 26 }}>Almost there</h1>
        <p style={{ color: '#6d6480', lineHeight: 1.5, marginTop: 0 }}>
          Tap once to open My Little Wanderers.
        </p>
        {hasAuthToken ? (
          <button
            type="button"
            onClick={finishSignIn}
            style={{ display: 'inline-flex', justifyContent: 'center', width: '100%', boxSizing: 'border-box', marginTop: 12, padding: '12px 16px', borderRadius: 12, background: '#5f3da4', color: '#fff', fontWeight: 800, textDecoration: 'none' }}
          >
            Open My Little Wanderers
          </button>
        ) : (
          <a
            href="/login"
            style={{ display: 'inline-flex', justifyContent: 'center', width: '100%', boxSizing: 'border-box', marginTop: 12, padding: '12px 16px', borderRadius: 12, background: '#5f3da4', color: '#fff', fontWeight: 800, textDecoration: 'none' }}
          >
            Request a fresh login link
          </a>
        )}
      </section>
    </main>
  );
}
