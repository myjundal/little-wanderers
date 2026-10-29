'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase/browser';

export default function AuthLinkPage() {
  return <Suspense fallback={<main style={{ padding: 24 }}>Opening your sign-in link…</main>}><AuthLinkContent /></Suspense>;
}

function AuthLinkContent() {
  const searchParams = useSearchParams();
  const hasAuthToken = searchParams.has('code') || searchParams.has('token_hash');
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    if (hasAuthToken) return;
    const checkSession = async () => {
      const fragment = new URLSearchParams(window.location.hash.slice(1));
      const accessToken = fragment.get('access_token');
      const refreshToken = fragment.get('refresh_token');
      if (accessToken && refreshToken) {
        // Invitations have no PKCE challenge. Remove bearer tokens before initializing the PKCE client.
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
      }
      const supabase = createBrowserSupabaseClient();
      if (accessToken && refreshToken) {
        const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
        if (error) return;
      }
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session) window.location.replace(`/auth/finish?next=${encodeURIComponent(searchParams.get('next') || '/landing')}`);
    };

    void checkSession();
  }, [hasAuthToken, searchParams]);

  function finishSignIn() {
    if (opening) return;
    setOpening(true);
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
            disabled={opening}
            style={{ display: 'inline-flex', justifyContent: 'center', width: '100%', boxSizing: 'border-box', marginTop: 12, padding: '12px 16px', borderRadius: 12, background: opening ? '#b8acd1' : '#5f3da4', color: '#fff', fontWeight: 800, textDecoration: 'none', border: 'none' }}
          >
            {opening ? 'Opening...' : 'Join/Login to My Little Wanderers'}
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
