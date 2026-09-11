'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';

export default function SoftOpeningSignInButton({ children }: { children: ReactNode }) {
  return (
    <Link
      href="/login"
      onClick={() => {
        sessionStorage.setItem('post_login_redirect', '/landing/soft-opening');
      }}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 52,
        padding: '10px 24px',
        borderRadius: 999,
        background: '#A78BCB',
        color: '#fff',
        fontWeight: 800,
        textDecoration: 'none',
        boxShadow: '0 14px 28px rgba(125,103,156,.22)',
      }}
    >
      {children}
    </Link>
  );
}
