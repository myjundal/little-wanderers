'use client';
import Link from 'next/link';
import type { CSSProperties } from 'react';
const iconWrap: CSSProperties = { display: 'inline-flex', width: 18, height: 18, marginRight: 8, verticalAlign: 'middle' };

export default function ContactPage() {
  return (
    <main style={{ padding: '16px clamp(12px, 4vw, 24px)', maxWidth: 760, margin: '0 auto' }}>
      <section style={{ border: '1px solid #e3d0fb', borderRadius: 22, background: 'linear-gradient(180deg,#fff,#f7efff)', padding: 18, boxShadow: '0 10px 20px rgba(120,87,177,0.08)' }}>
        <h1 style={{ color: '#4f3f82', marginTop: 0, fontSize: 'clamp(2rem, 4vw, 2.6rem)' }}>Contact us</h1>
        <p style={{ color: '#6f628d' }}>Let’s stay connected. Tap one below to reach us quickly.</p>
        <div style={{ display: 'grid', gap: 10 }}>
          <a style={{ border: '1px solid #d9c8f7', borderRadius: 12, padding: '10px 12px', textDecoration: 'none', color: '#5f3da4', background: '#fff' }} href="https://instagram.com/littlewanderers.weha" target="_blank" rel="noreferrer"><span style={iconWrap}><svg viewBox="0 0 24 24" fill="none"><defs><linearGradient id="ig" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#feda75"/><stop offset="50%" stopColor="#d62976"/><stop offset="100%" stopColor="#4f5bd5"/></linearGradient></defs><rect x="3" y="3" width="18" height="18" rx="5" stroke="url(#ig)" strokeWidth="2"/><circle cx="12" cy="12" r="4" stroke="url(#ig)" strokeWidth="2"/><circle cx="17.5" cy="6.5" r="1.2" fill="#d62976"/></svg></span>Instagram</a>
          <a style={{ border: '1px solid #d9c8f7', borderRadius: 12, padding: '10px 12px', textDecoration: 'none', color: '#5f3da4', background: '#fff' }} href="https://facebook.com/littlewanderers.weha" target="_blank" rel="noreferrer"><span style={iconWrap}><svg viewBox="0 0 24 24" fill="none"><path d="M13.5 21V13.5H16L16.5 10.5H13.5V8.9C13.5 8 13.9 7.5 15 7.5H16.6V4.8C16.3 4.7 15.3 4.5 14.1 4.5C11.6 4.5 10 6 10 8.8V10.5H7.5V13.5H10V21H13.5Z" fill="#1877F2"/></svg></span>Facebook</a>
          <Link style={{ border: '1px solid #d9c8f7', borderRadius: 12, padding: '10px 12px', textDecoration: 'none', color: '#5f3da4', background: '#fff' }} href="/visit-us">📍 Visit us</Link>
        </div>
        <p style={{ marginTop: 14 }}><Link href="/landing" style={{ color: '#5f3da4', fontWeight: 700 }}>← Back to dashboard</Link></p>
      </section>
      <div>
      </div>
    </main>
  );
}
