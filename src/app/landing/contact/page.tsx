'use client';
import Link from 'next/link';

export default function ContactPage() {
  return (
    <main style={{ padding: '16px clamp(12px, 4vw, 24px)', maxWidth: 760, margin: '0 auto' }}>
      <h1 style={{ color: '#4f3f82' }}>Contact</h1>
      <div style={{ display: 'grid', gap: 10 }}>
        <a href="https://instagram.com/littlewanderers.weha" target="_blank" rel="noreferrer">Instagram</a>
        <a href="https://facebook.com/littlewanderers.weha" target="_blank" rel="noreferrer">Facebook</a>
        <Link href="/visit-us">Visit us</Link>
      </div>
    </main>
  );
}
