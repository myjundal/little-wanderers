'use client';

import { useOperatorAccess } from '@/lib/use-owner-dashboard-access';
import Link from 'next/link';
import type { CSSProperties } from 'react';

type StaffToolNavProps = {
  active?: 'checkin' | 'home' | 'families' | 'classes' | 'parties' | 'campaigns' | 'openPlayReservations';
};

const linkStyle: CSSProperties = {
  borderRadius: 12,
  border: '1px solid #d9c8f7',
  padding: '10px 14px',
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
  const { role, isStaff, isInstructor, isKiosk } = useOperatorAccess();
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <Link href="/" style={linkStyle}>
        Main Homepage
      </Link>
      <Link href={isKiosk ? '/staff/dashboard' : '/landing'} style={linkStyle}>
        {!role ? 'Dashboard' : isStaff ? 'Staff Dashboard' : 'Owner Dashboard'}
      </Link>
      <Link href="/staff" style={styleFor(active === 'home')}>
        {!role ? 'Tools' : isStaff ? 'Staff Tool' : 'Owner Tool'}
      </Link>
      <Link href="/staff/checkin" style={styleFor(active === 'checkin')}>
        Check-in &amp; payment
      </Link>
      <Link href="/staff/families" style={styleFor(active === 'families')}>
        Family management
      </Link>
      {isInstructor && <Link href="/teaching" style={linkStyle}>Teaching Classes</Link>}
      <Link href="/staff/classes" style={styleFor(active === 'classes')}>
        Class pre-registrations
      </Link>
      {role && !isStaff && <>
      <Link href="/staff/campaigns" style={styleFor(active === 'campaigns')}>
        Email campaigns
      </Link>
      <Link href="/staff/open-play-reservations" style={styleFor(active === 'openPlayReservations')}>
        Open Play reservations
      </Link>
      <Link href="/staff/parties" style={styleFor(active === 'parties')}>
        Party management
      </Link>
      </>}
    </div>
  );
}
