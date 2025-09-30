'use client';
import { useEffect, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabaseClient';

export default function AuthCallback() {
  const [msg, setMsg] = useState('Signing you in...');

  useEffect(() => {
    const run = async () => {
      const supabase = supabaseBrowser();
      const {
        data: { session },
        error
      } = await supabase.auth.getSession();

      if (error || !session) {
        setMsg(`Sign-in failed: ${error?.message || 'No session'}`);
        return;
      }

      setMsg('Signed in! Redirecting...');
      const next = sessionStorage.getItem('post_login_redirect') || '/landing';
      sessionStorage.removeItem('post_login_redirect');
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

