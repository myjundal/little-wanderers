'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useState } from 'react';
import { useOperatorAccess } from '@/lib/use-owner-dashboard-access';
import { SHOW_CUSTOMER_MEMBERSHIP } from '@/lib/feature-flags';
import StaffToolNav from '@/components/staff/StaffToolNav';

export default function LandingMoreMenu() {
  const [open, setOpen] = useState(false);
  const { isLoading, canUseOwnerDashboard, isInstructor, isKiosk } = useOperatorAccess();

  return (
    <div style={{ marginBottom: 12, position: 'sticky', top: 8, zIndex: 40 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, background: '#f7f4ef', border: '1px solid #e8dfef', borderRadius: 12, padding: '8px 10px' }}>
        <Link href={isKiosk ? (canUseOwnerDashboard ? '/staff/dashboard' : '/teaching') : '/landing'} style={{ fontWeight: 800, color: '#4f3f82', textDecoration: 'none', display: 'inline-flex', gap: 8, alignItems: 'center' }}>
          <Image src="/logo.png" alt="Little Wanderers logo" width={34} height={34} />
          Little Wanderers
        </Link>
        <button type="button" disabled={isLoading} onClick={() => setOpen((v) => !v)} aria-label="Open more menu" style={{ border: '1px solid #d9c8f7', background: '#fff', borderRadius: 12, padding: '8px 10px', fontSize: 14, fontWeight: 700, color: '#4f3f82' }}>
          ☰ More
        </button>
      </header>
      {open && !isLoading && (
        <section style={{ display: 'grid', gap: 10, border: '1px solid #e3d0fb', borderRadius: 14, background: '#fffdf9', padding: 12 }}>
          {canUseOwnerDashboard ? <div onClick={() => setOpen(false)}><StaffToolNav /></div> : <>
          <Link style={{ color: '#4f3f82', fontWeight: 800 }} onClick={() => setOpen(false)} href="/">Main Homepage</Link>
          <Link style={{ color: '#4f3f82', fontWeight: 800 }} onClick={() => setOpen(false)} href={isInstructor ? '/teaching' : '/landing'}>
            {isInstructor ? 'Teaching Classes' : 'My Dashboard'}
          </Link>
          </>}
          {isKiosk && <Link onClick={() => setOpen(false)} href="/staff-login">Log out &amp; clock out</Link>}
          {isInstructor && !canUseOwnerDashboard && <>
            <Link onClick={() => setOpen(false)} href="/employee">{isKiosk ? 'My Timecards' : 'My PIN & Timecards'}</Link>
            {!isKiosk && <><Link onClick={() => setOpen(false)} href="/landing/classschedule">My Classes</Link>
            <Link onClick={() => setOpen(false)} href="/landing/party">My Parties</Link></>}
          </>}
          {!canUseOwnerDashboard && !isInstructor && (
            <>
              <Link style={{ color: '#4f3f82', fontWeight: 600 }} onClick={() => setOpen(false)} href="/landing/people">My Info/People</Link>
              {SHOW_CUSTOMER_MEMBERSHIP && (
                <Link style={{ color: '#4f3f82', fontWeight: 600 }} onClick={() => setOpen(false)} href="/landing/membership">My Membership</Link>
              )}
              <Link style={{ color: '#4f3f82', fontWeight: 600 }} onClick={() => setOpen(false)} href="/landing/classschedule">My Classes</Link>
              <Link style={{ color: '#4f3f82', fontWeight: 600 }} onClick={() => setOpen(false)} href="/landing/party">My Parties</Link>
              <Link style={{ color: '#4f3f82', fontWeight: 600 }} onClick={() => setOpen(false)} href="/landing/contact">Contact</Link>
              <Link style={{ color: '#4f3f82', fontWeight: 600 }} onClick={() => setOpen(false)} href="/faq">FAQ</Link>
            </>
          )}
        </section>
      )}
    </div>
  );
}
