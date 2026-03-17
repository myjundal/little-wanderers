import Image from 'next/image';
import Link from 'next/link';

export const metadata = {
  title: 'Little Wanderers — Sensory-filled Learning Play Adventure',
  description: 'Play, learn, and wander in West Hartford.',
};

const LOGO_SRC = '/brand-mark.svg';

const highlights = [
  {
    icon: '🪐',
    title: 'Sensory Exploration Zones',
    body: 'Soft-light stations, tactile tables, and movement pathways support curiosity and confidence.',
  },
  {
    icon: '🧸',
    title: 'Play Café Comfort',
    body: 'A cozy indoor play café mood with curated play corners and premium parent-friendly flow.',
  },
  {
    icon: '✨',
    title: 'Easy Booking Experience',
    body: 'Class, membership, and party booking tools are playful on the surface and reliable underneath.',
  },
];

export default function HomePage() {
  return (
    <main style={{ maxWidth: 1180, margin: '20px auto 40px', padding: 26, display: 'grid', gap: 18 }}>
      <section
        style={{
          borderRadius: 30,
          border: '1px solid #e1cef9',
          background:
            'radial-gradient(circle at 10% 15%, #ffffff 0%, #f8f0ff 35%, #f0e2ff 100%)',
          boxShadow: '0 26px 48px rgba(123, 83, 182, 0.18)',
          padding: 20,
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: -40,
            right: -20,
            width: 170,
            height: 170,
            borderRadius: '50%',
            background: 'radial-gradient(circle,#fff,#eed8ff)',
            opacity: 0.75,
          }}
        />
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(340px, 1.1fr) minmax(260px, 0.9fr)',
            alignItems: 'center',
            gap: 16,
            position: 'relative',
          }}
        >
          <div style={{ padding: 14 }}>
            <span
              style={{
                display: 'inline-block',
                border: '1px solid #d6bff4',
                borderRadius: 999,
                padding: '7px 13px',
                fontSize: 12,
                fontWeight: 700,
                color: '#6b56a3',
                background: '#fff',
              }}
            >
              🌙 WEST HARTFORD · INDOOR PLAY STUDIO & CAFE
            </span>

            <h1 style={{ fontSize: 50, lineHeight: 1.05, margin: '14px 0 10px', color: '#4a397c' }}>
              Tiny explorers,
              <br />
              magical galaxy play.
            </h1>

            <p style={{ margin: 0, color: '#6f628d', fontSize: 18, maxWidth: 640 }}>
              A dreamy lavender play café for sensory adventures, story-led imagination, and cozy family moments.
            </p>

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 18 }}>
              <Link
                href="/login"
                style={{
                  background: 'linear-gradient(180deg,#cbaef5,#9f7ddc)',
                  color: '#fff',
                  borderRadius: 999,
                  padding: '12px 20px',
                  fontWeight: 800,
                  boxShadow: '0 8px 16px rgba(124, 85, 187, 0.3)',
                }}
              >
                Start Membership
              </Link>
              <Link
                href="/pricing"
                style={{
                  background: '#fff',
                  color: '#5b4a95',
                  borderRadius: 999,
                  padding: '12px 18px',
                  fontWeight: 800,
                  border: '1px solid #cfbbef',
                }}
              >
                View Pricing
              </Link>
              <Link
                href="/faq"
                style={{
                  background: '#fff',
                  color: '#5b4a95',
                  borderRadius: 999,
                  padding: '12px 18px',
                  fontWeight: 700,
                  border: '1px solid #e0d0f6',
                }}
              >
                Read FAQ
              </Link>
            </div>
          </div>

          <div style={{ padding: 10 }}>
            <div
              style={{
                borderRadius: 24,
                border: '1px solid #dfccfb',
                background: 'linear-gradient(180deg,#fff,#faf4ff)',
                boxShadow: '0 20px 36px rgba(122, 88, 180, 0.22)',
                padding: 14,
              }}
            >
              <Image
                src={LOGO_SRC}
                alt="Little Wanderers brand fox"
                width={620}
                height={620}
                priority
                style={{ width: '100%', height: 'auto', borderRadius: 16 }}
              />
            </div>
          </div>
        </div>
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 12 }}>
        {highlights.map((item) => (
          <article
            key={item.title}
            style={{
              border: '1px solid #e8dbfb',
              borderRadius: 22,
              background: 'linear-gradient(180deg,#fff,#fcf9ff)',
              padding: 16,
              boxShadow: '0 8px 20px rgba(129, 98, 186, 0.1)',
            }}
          >
            <div style={{ fontSize: 24 }}>{item.icon}</div>
            <h3 style={{ margin: '6px 0 0', fontSize: 19, color: '#4d3c80' }}>{item.title}</h3>
            <p style={{ margin: '8px 0 0', color: '#6f648d' }}>{item.body}</p>
          </article>
        ))}
      </section>

      <section
        style={{
          border: '1px solid #e8dbfb',
          borderRadius: 20,
          background: 'linear-gradient(110deg,#ffffff,#f3e8ff)',
          padding: 18,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div>
          <h3 style={{ margin: 0, color: '#4f3e83' }}>🚀 Ready for your first little adventure?</h3>
          <p style={{ margin: '6px 0 0', color: '#6f648d' }}>
            Create your account and manage classes, memberships, and party bookings in one playful place.
          </p>
        </div>
        <Link href="/login" style={{ fontWeight: 800, color: '#4f3e83' }}>
          Go to Login →
        </Link>
      </section>
    </main>
  );
}
