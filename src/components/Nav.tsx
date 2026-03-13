'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase/browser';

export default function Nav() {
  const [loggedIn, setLoggedIn] = useState(false);

  useEffect(() => {
    const supabase = createBrowserSupabaseClient();
    supabase.auth.getSession().then(({ data: { session } }) => {
      setLoggedIn(!!session);
    });
  }, []);

  return (
    <nav
      style={{
        display: 'flex',
        gap: 16,
        padding: '14px 18px',
        borderBottom: '1px solid #e4d8f8',
        alignItems: 'center',
        background: 'rgba(255,255,255,0.85)',
        backdropFilter: 'blur(6px)',
      }}
    >
      <Link
        href="/"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 10, fontWeight: 800, color: '#5a4692' }}
      >
        <Image src="/brand-mark.svg" alt="Little Wanderers logo" width={28} height={28} style={{ borderRadius: 8 }} />
        <span>Little Wanderers</span>
      </Link>
      <div style={{ marginLeft: 'auto', display: 'flex', gap: 14 }}>
        <Link href="/pricing">Pricing</Link>
        <Link href="/faq">FAQ</Link>
        {loggedIn ? <Link href="/landing">Go to App</Link> : <Link href="/login">Log in</Link>}
      </div>
    </nav>
  );
}
