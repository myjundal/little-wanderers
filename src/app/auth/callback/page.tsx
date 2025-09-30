'use client';
import { useEffect, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabaseClient';

export default function AuthCallback() {
  const [msg, setMsg] = useState('Signing you in...');

  useEffect(() => {
    const run = async () => {
      try {
        const supabase = supabaseBrowser();

        // Exchange the code/hash in the URL for a session
        const { data, error } = await 
supabase.auth.exchangeCodeForSession(window.location.href);
        if (error) {
          setMsg(`Sign-in failed: ${error.message}`);
          return;
        }

        // Optional: you can also listen on onAuthStateChange, but this is enough
        setMsg('Signed in! Redirecting...');
        const next = sessionStorage.getItem('post_login_redirect') || '/app';
        sessionStorage.removeItem('post_login_redirect');
        window.location.replace(next);
      } catch (e: any) {
        setMsg(`Unexpected error: ${e?.message ?? 'unknown'}`);
      }
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

