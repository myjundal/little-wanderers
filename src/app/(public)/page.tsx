import Image from 'next/image';
import Link from 'next/link';
import type { CSSProperties } from 'react';

export const metadata = {
  title: 'Little Wanderers — Sensory-filled Learning Play Adventure',
  description: 'Play, learn, and wander in West Hartford.',
};

const pillStyle: CSSProperties = {
  display: 'inline-block',
  padding: '6px 12px',
  borderRadius: 999,
  border: '1px solid #d9c9f4',
  background: 'rgba(255,255,255,0.85)',
  color: '#6c58a6',
  fontWeight: 700,
  fontSize: 13,
};

export default function HomePage() {
  return (
    <main style={{ maxWidth: 1060, margin: '22px auto', padding: 24 }}>
      <section
        style={{
          display: 'grid',
          gridTemplateColumns: '1.1fr 0.9fr',
          gap: 24,
          alignItems: 'center',
          padding: 8,
        }}
      >
        <div>
          <span style={pillStyle}>West Hartford • Sensory Play Studio</span>
          <h1 style={{ fontSize: 44, lineHeight: 1.1, marginTop: 14, marginBottom: 12 }}>
            A dreamy, calm play world
            <br />
            for curious little wanderers
          </h1>
          <p style={{ color: '#685d86', fontSize: 18, maxWidth: 620 }}>
            We blend sensory-friendly exploration, movement, and family connection in a soft,
            welcoming environment designed for young children.
          </p>

          <div style={{ display: 'flex', gap: 12, marginTop: 20, flexWrap: 'wrap' }}>
            <Link
              href="/login"
              style={{
                padding: '11px 18px',
                borderRadius: 14,
                background: 'linear-gradient(180deg,#c5aff0,#a684de)',
                color: '#fff',
                fontWeight: 800,
              }}
            >
              Start with Membership
            </Link>
            <Link
              href="/pricing"
              style={{
                padding: '11px 18px',
                borderRadius: 14,
                border: '1px solid #cdb9ef',
                background: '#fff',
                color: '#5f4c96',
                fontWeight: 700,
              }}
            >
              View Pricing
            </Link>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(120px,1fr))', gap: 10, marginTop: 20 }}>
            <div style={{ padding: 12, borderRadius: 14, background: '#fff', border: '1px solid #eadffd' }}>
              <strong>9AM–6PM</strong>
              <p style={{ margin: '6px 0 0', color: '#766b94', fontSize: 13 }}>Sun–Thu</p>
            </div>
            <div style={{ padding: 12, borderRadius: 14, background: '#fff', border: '1px solid #eadffd' }}>
              <strong>9AM–7PM</strong>
              <p style={{ margin: '6px 0 0', color: '#766b94', fontSize: 13 }}>Fri–Sat</p>
            </div>
            <div style={{ padding: 12, borderRadius: 14, background: '#fff', border: '1px solid #eadffd' }}>
              <strong>West Hartford</strong>
              <p style={{ margin: '6px 0 0', color: '#766b94', fontSize: 13 }}>Connecticut</p>
            </div>
          </div>
        </div>

        <div
          style={{
            borderRadius: 24,
            background: 'linear-gradient(180deg, rgba(255,255,255,0.9), rgba(246,239,255,0.95))',
            border: '1px solid #e5d9f8',
            padding: 18,
            boxShadow: '0 18px 36px rgba(125,95,186,0.16)',
          }}
        >
          <Image
            src="/brand-mark.svg"
            alt="Little Wanderers brand illustration"
            width={420}
            height={420}
            style={{ width: '100%', height: 'auto', borderRadius: 18 }}
            priority
          />
          <p style={{ marginTop: 10, color: '#6f648d', textAlign: 'center' }}>
            Gentle play. Magical moments. Professional care.
          </p>
        </div>
      </section>

      <section style={{ marginTop: 26, display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14 }}>
        {[
          {
            title: 'Sensory-Friendly Space',
            body: 'Soft lighting, calm corners, and thoughtfully curated activities for confident exploration.',
          },
          {
            title: 'Membership-Centered',
            body: 'Manage family profiles, memberships, class bookings, and QR check-ins in one app.',
          },
          {
            title: 'Classes & Parties',
            body: 'Book classes and request parties with a simple, modern experience designed for busy parents.',
          },
        ].map((item) => (
          <article
            key={item.title}
            style={{
              background: '#fff',
              border: '1px solid #e9dcfb',
              borderRadius: 18,
              padding: 16,
            }}
          >
            <h3 style={{ marginTop: 0, marginBottom: 8 }}>{item.title}</h3>
            <p style={{ margin: 0, color: '#6f648d' }}>{item.body}</p>
          </article>
        ))}
      </section>

      <section
        style={{
          marginTop: 22,
          padding: 18,
          borderRadius: 18,
          border: '1px solid #e8dbfb',
          background: 'linear-gradient(120deg,#ffffff,#f4ecff)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <h3 style={{ margin: 0 }}>Ready to wander with us?</h3>
          <p style={{ margin: '6px 0 0', color: '#6f648d' }}>
            Start with pricing, then sign in to manage your family and bookings.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Link href="/faq">FAQ</Link>
          <Link href="/pricing">Pricing</Link>
          <Link href="/login">Log in</Link>
        </div>
      </section>
    </main>
  );
}
