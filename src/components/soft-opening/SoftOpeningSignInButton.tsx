'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';

export default function SoftOpeningSignInButton({ children }: { children: ReactNode }) {
  return (
    <Link
      href="/login?next=/landing/soft-opening"
      onClick={() => {
        sessionStorage.setItem('post_login_redirect', '/landing/soft-opening');
      }}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 50,
        width: '100%',
        fontSize: 13,
        padding: '10px 24px',
        borderRadius: 999,
        background: '#9471ae',
        color: '#fff',
        fontWeight: 600,
        textDecoration: 'none',
        boxShadow: 'none',
      }}
    >
      {children}
    </Link>
  );
}
