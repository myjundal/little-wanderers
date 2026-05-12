'use client';
import Link from 'next/link';

export default function ContactPage() {
  return (
    <main style={{ padding: '16px clamp(12px, 4vw, 24px)', maxWidth: 760, margin: '0 auto' }}>
      <section style={{ border: '1px solid #e3d0fb', borderRadius: 22, background: 'linear-gradient(180deg,#fff,#f7efff)', padding: 18, boxShadow: '0 10px 20px rgba(120,87,177,0.08)' }}>
        <h1 style={{ color: '#4f3f82', marginTop: 0, fontSize: 'clamp(2rem, 4vw, 2.6rem)' }}>Contact us</h1>
        <p style={{ color: '#6f628d' }}>Let’s stay connected. Tap one below to reach us quickly.</p>
        <div style={{ display: 'grid', gap: 10 }}>
          <a style={{ border: '1px solid #d9c8f7', borderRadius: 12, padding: '10px 12px', textDecoration: 'none', color: '#5f3da4', background: '#fff' }} href="https://instagram.com/littlewanderers.weha" target="_blank" rel="noreferrer">📸 Instagram</a>
          <a style={{ border: '1px solid #d9c8f7', borderRadius: 12, padding: '10px 12px', textDecoration: 'none', color: '#5f3da4', background: '#fff' }} href="https://facebook.com/littlewanderers.weha" target="_blank" rel="noreferrer">📘 Facebook</a>
          <Link style={{ border: '1px solid #d9c8f7', borderRadius: 12, padding: '10px 12px', textDecoration: 'none', color: '#5f3da4', background: '#fff' }} href="/visit-us">Visit us</Link>
        </div>
        <p style={{ marginTop: 14 }}><Link href="/landing" style={{ color: '#5f3da4', fontWeight: 700 }}>← Back to dashboard</Link></p>
      </section>
      <div>
      </div>
    </main>
  );
}
