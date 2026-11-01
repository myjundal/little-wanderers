'use client';

import Link from 'next/link';
import type { CSSProperties } from 'react';

type StaffToolNavProps = {
  active?: 'checkin' | 'home' | 'families' | 'classes' | 'parties' | 'campaigns';
};

const linkStyle: CSSProperties = {
  borderRadius: 12,
  border: '1px solid #d9c8f7',
  padding: '14px 16px',
  color: '#5f3da4',
  textDecoration: 'none',
  fontWeight: 700,
  background: '#fff',
};

function styleFor(active: boolean): CSSProperties {
  return {
    ...linkStyle,
    background: active ? '#f3ebff' : linkStyle.background,
    borderColor: active ? '#b995ef' : linkStyle.borderColor,
  };
}

export default function StaffToolNav({ active }: StaffToolNavProps) {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <Link href="/" style={linkStyle}>
        Main Homepage
      </Link>
      <Link href="/staff/dashboard" style={linkStyle}>
        Staff Dashboard
      </Link>
      <Link href="/staff/checkin" style={styleFor(active === 'checkin')}>
        Check-in &amp; Payment
      </Link>
      <Link href="/staff/parties" style={styleFor(active === 'parties')}>
        Party Management
      </Link>
      <Link href="/staff/families" style={styleFor(active === 'families')}>
        Family Management
      </Link>
      <Link href="/staff/classes" style={styleFor(active === 'classes')}>
        Class Management
      </Link>
    </div>
  );
}
