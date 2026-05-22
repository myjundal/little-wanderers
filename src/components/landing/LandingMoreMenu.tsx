'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useState } from 'react';

export default function LandingMoreMenu() {
  const [open, setOpen] = useState(false);

  return (
    <div style={{ marginBottom: 12 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
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
          <Link href="/landing/people">My People</Link>
          <Link href="/landing/qr">My QR Codes</Link>
          <Link href="/landing/membership">My Membership</Link>
          <Link href="/landing/classschedule">Class Schedule / My Class Booking</Link>
          <Link href="/landing/party">Party Calendar / My Parties</Link>
          <Link href="/landing/contact">Contact</Link>
          <Link href="/faq">FAQ</Link>
        </section>
      )}
    </div>
  );
}
