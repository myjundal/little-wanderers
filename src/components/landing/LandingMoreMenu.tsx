'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useState } from 'react';
import { useOwnerDashboardAccess } from '@/lib/use-owner-dashboard-access';
import { SHOW_CUSTOMER_CLASS_BOOKING, SHOW_CUSTOMER_MEMBERSHIP } from '@/lib/feature-flags';

export default function LandingMoreMenu() {
  const [open, setOpen] = useState(false);
  const canUseOwnerDashboard = useOwnerDashboardAccess();

  return (
    <div style={{ marginBottom: 12, position: 'sticky', top: 8, zIndex: 40 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, background: '#f7f4ef', border: '1px solid #e8dfef', borderRadius: 12, padding: '8px 10px' }}>
        <Link href="/landing" style={{ fontWeight: 800, color: '#4f3f82', textDecoration: 'none', display: 'inline-flex', gap: 8, alignItems: 'center' }}>
          <Image src="/logo.png" alt="Little Wanderers logo" width={34} height={34} />
          Little Wanderers
        </Link>
        <button type="button" onClick={() => setOpen((v) => !v)} aria-label="Open more menu" style={{ border: '1px solid #d9c8f7', background: '#fff', borderRadius: 12, padding: '8px 10px', fontSize: 14, fontWeight: 700, color: '#4f3f82' }}>
          ☰ More
        </button>
      </header>
      {open && (
        <section style={{ display: 'grid', gap: 10, border: '1px solid #e3d0fb', borderRadius: 14, background: '#fffdf9', padding: 12 }}>
          <Link style={{ color: '#4f3f82', fontWeight: 800 }} onClick={() => setOpen(false)} href="/">Main Homepage</Link>
          <Link style={{ color: '#4f3f82', fontWeight: 800 }} onClick={() => setOpen(false)} href="/landing">
            {canUseOwnerDashboard ? 'Owner/Staff Dashboard' : 'My Dashboard'}
          </Link>
          {canUseOwnerDashboard && (
            <>
              <Link style={{ color: '#5f3da4', fontWeight: 800 }} onClick={() => setOpen(false)} href="/staff">Owner/Staff Tool</Link>
              <Link style={{ color: '#5f3da4', fontWeight: 800 }} onClick={() => setOpen(false)} href="/staff/checkin">Staff QR check-in</Link>
              <Link style={{ color: '#4f3f82', fontWeight: 600 }} onClick={() => setOpen(false)} href="/landing/party">Party Calendar / My Parties</Link>
            </>
          )}
          {!canUseOwnerDashboard && (
            <>
              <Link style={{ color: '#4f3f82', fontWeight: 600 }} onClick={() => setOpen(false)} href="/landing/people">My People</Link>
              <Link style={{ color: '#4f3f82', fontWeight: 600 }} onClick={() => setOpen(false)} href="/landing/qr">My QR Codes</Link>
              {SHOW_CUSTOMER_MEMBERSHIP && (
                <Link style={{ color: '#4f3f82', fontWeight: 600 }} onClick={() => setOpen(false)} href="/landing/membership">My Membership</Link>
              )}
              {SHOW_CUSTOMER_CLASS_BOOKING && (
                <Link style={{ color: '#4f3f82', fontWeight: 600 }} onClick={() => setOpen(false)} href="/landing/classschedule">Class Schedule / My Class Booking</Link>
              )}
              <Link style={{ color: '#4f3f82', fontWeight: 600 }} onClick={() => setOpen(false)} href="/landing/party">Party Calendar / My Parties</Link>
              <Link style={{ color: '#4f3f82', fontWeight: 600 }} onClick={() => setOpen(false)} href="/landing/contact">Contact</Link>
              <Link style={{ color: '#4f3f82', fontWeight: 600 }} onClick={() => setOpen(false)} href="/faq">FAQ</Link>
            </>
          )}
        </section>
      )}
    </div>
  );
}
