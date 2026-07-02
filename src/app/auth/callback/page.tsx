'use client';
import { useEffect, useState } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase/browser';

function getSafeNextPath(value: string | null) {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/landing';
  return value;
}

export default function AuthCallback() {
  const [msg, setMsg] = useState('Signing you in...');

  useEffect(() => {
    const run = async () => {
      const supabase = createBrowserSupabaseClient();
      const params = new URLSearchParams(window.location.search);
      const code = params.get('code');
      const mode = params.get('mode') || sessionStorage.getItem('post_login_journey');
      const next = getSafeNextPath(params.get('next') || sessionStorage.getItem('post_login_redirect'));

      if (code) {
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
        if (exchangeError) {
          setMsg(`Sign-in failed: ${exchangeError.message}`);
          return;
        }
      }

      const {
        data: { session },
        error
      } = await supabase.auth.getSession();

      if (error || !session) {
        setMsg(`Sign-in failed: ${error?.message || 'No session'}`);
        return;
      }

      setMsg('Signed in! Redirecting...');
      sessionStorage.removeItem('post_login_redirect');
      sessionStorage.removeItem('post_login_journey');

      if (mode === 'new') {
        await fetch('/api/waitlist/claim', { method: 'POST' }).catch(() => null);
        sessionStorage.setItem('post_onboarding_redirect', next);
        window.location.replace('/onboarding');
        return;
      }

      window.location.replace(next);
    };

    run();
  }, []);

  return (
    <main style={{ padding: 24 }}>
      <h1>Auth Callback</h1>
      <p>{msg}</p>
    </main>
  );
}
