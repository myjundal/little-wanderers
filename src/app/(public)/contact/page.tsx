import Link from 'next/link';

export const metadata = { title: 'Contact — Little Wanderers' };

export default function PublicContactPage() {
  return (
    <main style={{ maxWidth: 860, margin: '20px auto', padding: 24, background: '#F7F4EF', border: '1px solid #ece2d8', borderRadius: 32 }}>
      <h1 style={{ margin: 0, color: '#A78BCB', fontSize: 'clamp(2rem,4vw,3rem)' }}>Contact us</h1>
      <p style={{ color: '#4A4A4A', marginTop: 12 }}>We would love to hear from you.</p>
      <div style={{ display: 'grid', gap: 10, marginTop: 16 }}>
        <a style={{ border: '1px solid #d9c8f7', borderRadius: 12, padding: '10px 12px', textDecoration: 'none', color: '#5f3da4', background: '#fff' }} href="mailto:hello@thelittlewanderers.com">✉️ hello@thelittlewanderers.com</a>
        <a style={{ border: '1px solid #d9c8f7', borderRadius: 12, padding: '10px 12px', textDecoration: 'none', color: '#5f3da4', background: '#fff' }} href="https://www.instagram.com/littlewanderers.weha" target="_blank" rel="noreferrer">Instagram</a>
      </div>
      <p style={{ marginTop: 18 }}><Link href="/">← Back to home</Link></p>
    </main>
  );
}
