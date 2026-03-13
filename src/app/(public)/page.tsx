import Image from 'next/image';
import Link from 'next/link';

export const metadata = {
  title: 'Little Wanderers — Sensory-filled Learning Play Adventure',
  description: 'Play, learn, and wander in West Hartford.',
};

const highlights = [
  {
    title: 'Sensory-Friendly Design',
    body: 'A calm and beautiful environment with thoughtful lighting, flow, and activities for little ones.',
  },
  {
    title: 'Membership-First Experience',
    body: 'Everything in one place: family profiles, QR check-ins, classes, and party requests.',
  },
  {
    title: 'Professional Care',
    body: 'Warm, consistent operations and parent-friendly booking tools built for real daily routines.',
  },
];

export default function HomePage() {
  return (
    <main style={{ maxWidth: 1120, margin: '20px auto', padding: 28, borderRadius: 28 }}>
      <section style={{ display: 'grid', gridTemplateColumns: '1.1fr 0.9fr', gap: 26, alignItems: 'center' }}>
        <div>
          <span
            style={{
              display: 'inline-flex',
              border: '1px solid #d8c7f4',
              background: 'rgba(255, 255, 255, 0.9)',
              padding: '6px 12px',
              borderRadius: 999,
              color: '#6c58a6',
              fontWeight: 700,
              fontSize: 12,
              letterSpacing: '0.02em',
            }}
          >
            West Hartford • Sensory Learning Play
          </span>
          <h1 style={{ margin: '14px 0 12px', fontSize: 42, lineHeight: 1.13, color: '#4f3f74' }}>
            Soft, magical play for children.
            <br />
            Clear, professional experience for parents.
          </h1>
          <p style={{ color: '#6f648d', fontSize: 18, margin: 0, maxWidth: 640 }}>
            Little Wanderers brings together sensory exploration, movement, and imaginative play in a cozy
            lavender-toned space inspired by calm wonder.
          </p>

          <div style={{ display: 'flex', gap: 12, marginTop: 20, flexWrap: 'wrap' }}>
            <Link
              href="/login"
              style={{
                padding: '11px 18px',
                borderRadius: 14,
                fontWeight: 800,
                background: 'linear-gradient(180deg, #c7b0ef, #a684de)',
                color: '#fff',
              }}
            >
              Start Membership
            </Link>
            <Link
              href="/pricing"
              style={{
                padding: '11px 18px',
                borderRadius: 14,
                border: '1px solid #ceb9f0',
                background: '#fff',
                color: '#5f4c96',
                fontWeight: 800,
              }}
            >
              See Pricing
            </Link>
          </div>

          <div style={{ marginTop: 20, display: 'grid', gridTemplateColumns: 'repeat(3,minmax(120px,1fr))', gap: 10 }}>
            <article style={{ border: '1px solid #eadffd', background: '#fff', borderRadius: 14, padding: 12 }}>
              <strong style={{ display: 'block', color: '#4f3f74', marginBottom: 6 }}>Sun–Thu</strong>
              <span style={{ color: '#766b94', fontSize: 13 }}>9:00 AM – 6:00 PM</span>
            </article>
            <article style={{ border: '1px solid #eadffd', background: '#fff', borderRadius: 14, padding: 12 }}>
              <strong style={{ display: 'block', color: '#4f3f74', marginBottom: 6 }}>Fri–Sat</strong>
              <span style={{ color: '#766b94', fontSize: 13 }}>9:00 AM – 7:00 PM</span>
            </article>
            <article style={{ border: '1px solid #eadffd', background: '#fff', borderRadius: 14, padding: 12 }}>
              <strong style={{ display: 'block', color: '#4f3f74', marginBottom: 6 }}>Location</strong>
              <span style={{ color: '#766b94', fontSize: 13 }}>West Hartford, CT</span>
            </article>
          </div>
        </div>

        <div style={{ textAlign: 'center' }}>
          <div
            style={{
              padding: 16,
              borderRadius: 24,
              border: '1px solid #e5d9f8',
              background: 'linear-gradient(180deg, rgba(255, 255, 255, 0.94), rgba(244, 235, 255, 0.92))',
              boxShadow: '0 22px 44px rgba(125, 95, 186, 0.16)',
            }}
          >
            <Image
              src="/brand-mark.svg"
              alt="Little Wanderers dreamy fox logo"
              width={520}
              height={520}
              priority
              style={{ width: '100%', height: 'auto', borderRadius: 22 }}
            />
          </div>
          <p style={{ marginTop: 10, color: '#6f648d', fontSize: 14 }}>
            Your logo-led dreamy identity, elevated for a premium first impression.
          </p>
        </div>
      </section>

      <section style={{ marginTop: 30, display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14 }}>
        {highlights.map((item) => (
          <article key={item.title} style={{ background: '#fff', border: '1px solid #e9dcfb', borderRadius: 18, padding: 16 }}>
            <h3 style={{ margin: '0 0 8px' }}>{item.title}</h3>
            <p style={{ margin: 0, color: '#6f648d' }}>{item.body}</p>
          </article>
        ))}
      </section>

      <section
        style={{
          marginTop: 22,
          border: '1px solid #e8dbfb',
          borderRadius: 18,
          background: 'linear-gradient(120deg, #ffffff, #f4ecff)',
          padding: 18,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <h3 style={{ margin: 0 }}>Ready to begin your Little Wanderers journey?</h3>
          <p style={{ margin: '6px 0 0', color: '#6f648d' }}>
            Explore pricing and sign in to manage classes, memberships, and family bookings.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Link href="/faq">FAQ</Link>
          <Link href="/pricing">Pricing</Link>
          <Link href="/login">Log in</Link>
        </div>
      </section>
    </main>
  );
}
