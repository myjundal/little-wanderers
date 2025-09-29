'use client';
import { useState } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase/browser';

export default function Home() {
  const supabase = createBrowserSupabaseClient();
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const sendMagicLink = async () => {
    setPending(true);
    setMsg(null);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        // 로그인 완료 후 이동할 페이지
        emailRedirectTo: `${location.origin}/landing`,
      },
    });
    setPending(false);
    if (error) setMsg(`Error: ${error.message}`);
    else setMsg('Email sent. Please check your inbox (including spam).');
  };

  return (
    <main style={{ padding: 24, maxWidth: 520 }}>
      <h1>Little Wanderers</h1>
      <p>West Hartford Sensory-filled Learning Play Adventure</p>

      <div style={{ marginTop: 24 }}>
        <input
          type="email"
          placeholder="Please type your email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={{ padding: 8, width: '100%', boxSizing: 'border-box' }}
        />
        <button
          onClick={sendMagicLink}
          disabled={!email || pending}
          style={{ marginTop: 12, padding: '8px 12px' }}
        >
          {pending ? 'Sending...' : 'Send magic link'}
        </button>
        {msg && <p style={{ marginTop: 12 }}>{msg}</p>}
      </div>
    </main>
  );
}

