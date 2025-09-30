'use client';
import { useState } from 'react';
import { supabaseBrowser } from '@/lib/supabaseClient';

export default function Home() {
  const supabase = supabaseBrowser();
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const sendMagicLink = async () => {
    console.log('sendMagicLink called');
    setPending(true);
    setMsg(null);
    const redirectTo = `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback`;
    console.log('redirectTo:', redirectTo);
const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback`, 
	},
    });
    setPending(false);
    if (error) setMsg(`Error: ${error.message}`);
    else setMsg('Email sent. Please check your inbox (including spam).');
    sessionStorage.setItem('post_login_redirect', '/landing'); 
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

