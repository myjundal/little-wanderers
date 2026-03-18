'use client';
import { useEffect, useRef, useState } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase/browser';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const emailInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    emailInputRef.current?.focus();
  }, []);

  const sendMagicLink = async () => {
    setPending(true);
    setMsg(null);
    const redirectTo = `${window.location.origin}/auth/callback`;
    const supabase = createBrowserSupabaseClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: redirectTo,
      },
    });

    setPending(false);
    if (error) {
      setMsg(`Error: ${error.message}`);
      return;
    }

    setMsg('Email sent. Please check your inbox, including spam or promotions.');
    sessionStorage.setItem('post_login_redirect', '/landing');
  };

  return (
    <main style={{ padding: 24, maxWidth: 720, margin: '0 auto' }}>
      <section style={{ borderRadius: 28, border: '1px solid #e3d0fb', background: 'linear-gradient(180deg,#fff,#f7efff)', boxShadow: '0 18px 30px rgba(120,87,177,0.12)', padding: 24 }}>
        <p style={{ margin: 0, color: '#7a63a5', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Little Wanderers</p>
        <h1 style={{ marginBottom: 8, color: '#4f3f82' }}>Sign in with a magic link</h1>
        <p style={{ color: '#6d6480', lineHeight: 1.6 }}>Use the same login for customer and operator access. After signing in, you can head to your household dashboard and operator tools from there.</p>

        <div style={{ marginTop: 24 }}>
          <label htmlFor="email" style={{ display: 'block', marginBottom: 8, color: '#4f3f82', fontWeight: 600 }}>Email address</label>
          <input
            id="email"
            type="email"
            ref={emailInputRef}
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{ padding: '12px 14px', width: '100%', boxSizing: 'border-box', borderRadius: 14, border: '1px solid #d8c5f6' }}
          />
          <button
            onClick={sendMagicLink}
            disabled={!email || pending}
            style={{ marginTop: 12, padding: '12px 16px', borderRadius: 14, border: 'none', background: '#5f3da4', color: '#fff', fontWeight: 700, cursor: 'pointer' }}
          >
            {pending ? 'Sending…' : 'Send magic link'}
          </button>
          {msg && <p style={{ marginTop: 12, color: msg.startsWith('Error:') ? '#8a3f6b' : '#5f3da4' }}>{msg}</p>}
        </div>
      </section>
    </main>
  );
}
