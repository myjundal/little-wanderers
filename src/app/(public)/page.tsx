import Image from 'next/image';
import Link from 'next/link';

export const metadata = {
  title: 'Little Wanderers — Sensory-filled Learning Play Adventure',
  description: 'Play, learn, and wander in West Hartford.',
};

const LOGO_SRC = '/brand-mark.svg';

const highlights = [
  {
    title: 'Sensory Exploration Zones',
    body: 'Soft-light stations, tactile tables, and movement pathways support curiosity and confidence.',
  },
  {
    title: 'Professional Class & Booking System',
    body: 'Class, membership, and party booking tools are designed to feel easy for families and reliable for staff.',
  },
  {
    title: 'Indoor Play Studio + Café Mood',
    body: 'A warm lavender atmosphere with cozy details, playful storytelling, and parent-friendly comfort.',
  },
];

export default function HomePage() {
  return (
    <main
      style={{
        maxWidth: 1180,
        margin: '20px auto 40px',
        padding: 26,
        display: 'grid',
        gap: 18,
      }}
    >
      <section
        style={{
          borderRadius: 26,
          border: '1px solid #e4d7f9',
          background:
            'radial-gradient(circle at top right, #ffffff 0%, #f7efff 45%, #f2e7ff 100%)',
          boxShadow: '0 22px 45px rgba(119, 85, 172, 0.17)',
          padding: 18,
        }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(340px, 1.1fr) minmax(260px, 0.9fr)',
            alignItems: 'center',
            gap: 16,
          }}
        >
          <div style={{ padding: 14 }}>
            <span
              style={{
                display: 'inline-block',
                border: '1px solid #d8c5f4',
                borderRadius: 999,
                padding: '6px 12px',
                fontSize: 12,
                fontWeight: 700,
                color: '#6b56a3',
                background: '#fff',
              }}
            >
              WEST HARTFORD · INDOOR PLAY STUDIO / CAFE
            </span>

            <h1 style={{ fontSize: 48, lineHeight: 1.08, margin: '14px 0 10px', color: '#4a397c' }}>
              Tiny explorers,
              <br />
              big sensory adventures.
            </h1>

            <p style={{ margin: 0, color: '#6f628d', fontSize: 18, maxWidth: 640 }}>
              Little Wanderers is a boutique indoor play studio where imagination, movement, and sensory play meet a
              calm, premium family experience.
            </p>

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 18 }}>
              <Link
                href="/login"
                style={{
                  background: 'linear-gradient(180deg,#c8b2ef,#9d7ada)',
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
                  background: '#fff',
                  color: '#5b4a95',
                  borderRadius: 14,
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
                  borderRadius: 14,
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
                borderRadius: 22,
                border: '1px solid #e2d3fb',
                background: 'linear-gradient(180deg,#fff,#fbf8ff)',
                boxShadow: '0 20px 36px rgba(122, 88, 180, 0.18)',
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
              borderRadius: 18,
              background: '#fff',
              padding: 16,
              boxShadow: '0 8px 20px rgba(129, 98, 186, 0.07)',
            }}
          >
            <h3 style={{ margin: 0, fontSize: 19, color: '#4d3c80' }}>{item.title}</h3>
            <p style={{ margin: '8px 0 0', color: '#6f648d' }}>{item.body}</p>
          </article>
        ))}
      </section>

      <section
        style={{
          border: '1px solid #e8dbfb',
          borderRadius: 18,
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
          <h3 style={{ margin: 0, color: '#4f3e83' }}>Ready for your first indoor adventure?</h3>
          <p style={{ margin: '6px 0 0', color: '#6f648d' }}>
            Create your account and manage classes, memberships, and party booking requests in one beautiful place.
          </p>
        </div>
        <Link href="/login" style={{ fontWeight: 800, color: '#4f3e83' }}>
          Go to Login →
        </Link>
      </section>
    </main>
  );
}
