import Image from 'next/image';
import Link from 'next/link';

export const metadata = {
  title: 'Little Wanderers — Sensory-filled Learning Play Adventure',
  description: 'Play, learn, and wander in West Hartford.',
};

const cards = [
  {
    title: 'Designed for little nervous systems',
    body: 'Soft colors, gentle transitions, and sensory-safe zones help children regulate and explore with confidence.',
  },
  {
    title: 'Built for real parent life',
    body: 'Membership, classes, people profiles, and bookings are organized in one clear flow.',
  },
  {
    title: 'Warm brand, serious operations',
    body: 'A dreamy experience on the surface with reliable systems behind the scenes.',
  },
];

export default function HomePage() {
  return (
    <main style={{ maxWidth: 1160, margin: '18px auto', padding: 30 }}>
      <section
        style={{
          display: 'grid',
          gridTemplateColumns: '1.05fr 0.95fr',
          gap: 28,
          alignItems: 'stretch',
        }}
      >
        <div
          style={{
            border: '1px solid #e8dcfa',
            borderRadius: 26,
            background: 'linear-gradient(160deg, rgba(255,255,255,0.96), rgba(246,236,255,0.85))',
            padding: 26,
          }}
        >
          <span
            style={{
              display: 'inline-block',
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: '0.04em',
              color: '#6b58a5',
              border: '1px solid #d8c8f5',
              borderRadius: 999,
              padding: '6px 12px',
              background: '#fff',
            }}
          >
            WEST HARTFORD · SENSORY PLAY
          </span>

          <h1 style={{ fontSize: 46, lineHeight: 1.1, margin: '14px 0 12px' }}>
            Dreamy for kids.
            <br />
            Professional for families.
          </h1>

          <p style={{ color: '#6d628a', fontSize: 18, margin: 0 }}>
            We took your logo mood—soft clouds, moonlight lavender, and gentle wonder—and translated it into a
            clean, premium parent-facing experience.
          </p>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 22 }}>
            <Link
              href="/login"
              style={{
                background: 'linear-gradient(180deg,#c9b2f1,#a885df)',
                color: '#fff',
                borderRadius: 14,
                padding: '12px 18px',
                fontWeight: 800,
              }}
            >
              Start Membership
            </Link>
            <Link
              href="/pricing"
              style={{
                border: '1px solid #cdb8ef',
                borderRadius: 14,
                padding: '12px 18px',
                background: '#fff',
                color: '#5b4a94',
                fontWeight: 800,
              }}
            >
              View Pricing
            </Link>
          </div>

          <div style={{ marginTop: 18, display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10 }}>
            <div style={{ border: '1px solid #e9defb', borderRadius: 14, background: '#fff', padding: 12 }}>
              <strong>Hours</strong>
              <p style={{ margin: '6px 0 0', color: '#786d96', fontSize: 13 }}>Sun–Thu 9–6 / Fri–Sat 9–7</p>
            </div>
            <div style={{ border: '1px solid #e9defb', borderRadius: 14, background: '#fff', padding: 12 }}>
              <strong>Focus</strong>
              <p style={{ margin: '6px 0 0', color: '#786d96', fontSize: 13 }}>Sensory + Learning Play</p>
            </div>
            <div style={{ border: '1px solid #e9defb', borderRadius: 14, background: '#fff', padding: 12 }}>
              <strong>Location</strong>
              <p style={{ margin: '6px 0 0', color: '#786d96', fontSize: 13 }}>West Hartford, CT</p>
            </div>
          </div>
        </div>

        <div
          style={{
            borderRadius: 26,
            border: '1px solid #e6daf9',
            background: 'linear-gradient(180deg, #ffffff, #f3eafe)',
            boxShadow: '0 24px 46px rgba(124, 95, 183, 0.16)',
            padding: 18,
            display: 'grid',
            alignContent: 'start',
            gap: 10,
          }}
        >
          <Image
            src="/brand-mark.svg"
            alt="Little Wanderers fox logo"
            width={560}
            height={560}
            priority
            style={{ width: '100%', height: 'auto', borderRadius: 20 }}
          />
          <p style={{ margin: 0, color: '#70658d', textAlign: 'center' }}>
            This logo is now the core visual anchor across your homepage and navigation.
          </p>
        </div>
      </section>

      <section style={{ marginTop: 24, display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14 }}>
        {cards.map((card) => (
          <article key={card.title} style={{ border: '1px solid #eadffd', borderRadius: 18, background: '#fff', padding: 16 }}>
            <h3 style={{ margin: 0 }}>{card.title}</h3>
            <p style={{ color: '#6f648d', margin: '8px 0 0' }}>{card.body}</p>
          </article>
        ))}
      </section>

      <section
        style={{
          marginTop: 20,
          borderRadius: 18,
          border: '1px solid #e8dbfb',
          background: 'linear-gradient(120deg, #ffffff, #f4edff)',
          padding: 18,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <h3 style={{ margin: 0 }}>Ready to book your first visit?</h3>
          <p style={{ margin: '6px 0 0', color: '#6f648d' }}>
            Start with pricing, then log in to manage classes, memberships, and party requests.
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
