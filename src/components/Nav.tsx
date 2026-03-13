'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase/browser';

const LOGO_SRC = '/brand-mark.svg';

export default function Nav() {
  const [loggedIn, setLoggedIn] = useState(false);

  useEffect(() => {
    const supabase = createBrowserSupabaseClient();
    supabase.auth.getSession().then(({ data: { session } }) => setLoggedIn(!!session));
  }, []);

  return (
    <nav
      style={{
        display: 'flex',
        gap: 16,
        padding: '14px 20px',
        borderBottom: '1px solid #e3d6f7',
        alignItems: 'center',
        background: 'rgba(255,255,255,0.9)',
        backdropFilter: 'blur(8px)',
        position: 'sticky',
        top: 0,
        zIndex: 20,
      }}
    >
      <Link href="/" style={{ display: 'inline-flex', alignItems: 'center', gap: 10, color: '#56448e' }}>
        <Image src={LOGO_SRC} alt="Little Wanderers logo" width={34} height={34} style={{ borderRadius: 10 }} />
        <div style={{ display: 'grid', lineHeight: 1.1 }}>
          <strong style={{ fontSize: 15 }}>Little Wanderers</strong>
          <span style={{ fontSize: 11, color: '#8a7cae' }}>Sensory Learning Play</span>
        </div>
      </Link>

      <div style={{ marginLeft: 'auto', display: 'flex', gap: 16, alignItems: 'center' }}>
        <Link href="/pricing">Pricing</Link>
        <Link href="/faq">FAQ</Link>
        {loggedIn ? <Link href="/landing">Go to App</Link> : <Link href="/login">Log in</Link>}
      </div>
    </nav>
  );
}
