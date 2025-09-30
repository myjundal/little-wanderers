'use client';

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
    <nav style={{ display: 'flex', gap: 16, padding: '12px 16px', borderBottom: '1px solid #eee', alignItems: 'center' 
}}>
      <Link href="/" style={{ fontWeight: 700 }}>Little Wanderers</Link>
      <div style={{ marginLeft: 'auto', display: 'flex', gap: 12 }}>
        <Link href="/pricing">Pricing</Link>
        <Link href="/faq">FAQ</Link>
        {loggedIn ? (
          <Link href="/landing">Go to App</Link>
        ) : (
          <Link href="/login">Log in</Link>
        )}
      </div>
    </nav>
  );
}

