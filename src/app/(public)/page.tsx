import Image from 'next/image';
import Link from 'next/link';

export const metadata = {
  title: 'Little Wanderers — Sensory-filled Learning Play Adventure',
  description: 'Play, learn, and wander in West Hartford.',
};

const LOGO_SRC = '/brand-mark.svg';

const featureBubbles = [
  {
    emoji: '🌙',
    title: 'Moonlight Sensory Corners',
    body: 'Glow blocks, tactile walls, and soft play islands that invite calm curiosity.',
  },
  {
    emoji: '☄️',
    title: 'Imagination Orbit',
    body: 'Story-led role play stations where little wanderers hop between mini worlds.',
  },
  {
    emoji: '🍼',
    title: 'Parent Café Flow',
    body: 'Cozy café-style comfort while your child explores safely in sight.',
  },
  {
    emoji: '🎟️',
    title: 'Easy Bookings',
    body: 'Classes, memberships, and parties with a smooth modern booking experience.',
  },
];

export default function HomePage() {
  return (
    <main
      style={{
        maxWidth: 1200,
        margin: '18px auto 42px',
        padding: 24,
        display: 'grid',
        gap: 18,
        background: 'linear-gradient(180deg,#fcf9ff,#f5ecff)',
        borderRadius: 32,
        border: '1px solid #e8d8fb',
      }}
    >
      <section
        style={{
          borderRadius: 32,
          border: '1px solid #e1cef9',
          background: 'radial-gradient(circle at 0% 0%, #ffffff 0%, #f8eefe 52%, #efdfff 100%)',
          boxShadow: '0 26px 48px rgba(123, 83, 182, 0.2)',
          padding: 20,
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div style={{ position: 'absolute', top: 20, right: 24, fontSize: 30 }}>⭐</div>
        <div style={{ position: 'absolute', top: 72, right: 72, fontSize: 20 }}>✨</div>
        <div style={{ position: 'absolute', bottom: 16, left: 20, fontSize: 24 }}>🪐</div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(340px, 1.1fr) minmax(260px, 0.9fr)',
            alignItems: 'center',
            gap: 18,
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
                fontWeight: 800,
                color: '#6b56a3',
                background: '#fff',
              }}
            >
              💜 WEST HARTFORD · LAVENDER PLAY CAFE
            </span>

            <h1 style={{ fontSize: 56, lineHeight: 1.02, margin: '14px 0 10px', color: '#4b397f' }}>
              Little Galaxy
              <br />
              Big Wonder
            </h1>

            <p style={{ margin: 0, color: '#69598d', fontSize: 19, maxWidth: 620 }}>
              A dreamy, whimsical indoor play café for babies and toddlers — built for sensory exploration,
              imagination, and magical everyday adventures.
            </p>

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 18 }}>
              <Link
                href="/login"
                style={{
                  background: 'linear-gradient(180deg,#cdadf7,#9d79dd)',
                  color: '#fff',
                  borderRadius: 999,
                  padding: '12px 20px',
                  fontWeight: 800,
                  boxShadow: '0 8px 16px rgba(124, 85, 187, 0.35)',
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
                borderRadius: 28,
                border: '1px solid #dfccfb',
                background: 'linear-gradient(180deg,#fff,#faf4ff)',
                boxShadow: '0 22px 36px rgba(122, 88, 180, 0.22)',
                padding: 14,
              }}
            >
              <Image
                src={LOGO_SRC}
                alt="Little Wanderers brand fox"
                width={620}
                height={620}
                priority
                style={{ width: '100%', height: 'auto', borderRadius: 18 }}
              />
            </div>
          </div>
        </div>
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 12 }}>
        {featureBubbles.map((item) => (
          <article
            key={item.title}
            style={{
              border: '1px solid #e8dbfb',
              borderRadius: 24,
              background: 'linear-gradient(180deg,#fff,#fcf9ff)',
              padding: 16,
              boxShadow: '0 8px 20px rgba(129, 98, 186, 0.1)',
            }}
          >
            <div style={{ fontSize: 26 }}>{item.emoji}</div>
            <h3 style={{ margin: '6px 0 0', fontSize: 18, color: '#4d3c80' }}>{item.title}</h3>
            <p style={{ margin: '8px 0 0', color: '#6f648d', fontSize: 14 }}>{item.body}</p>
          </article>
        ))}
      </section>

      <section
        style={{
          border: '1px solid #e8dbfb',
          borderRadius: 24,
          background: 'linear-gradient(110deg,#ffffff,#f1e4ff)',
          padding: 18,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div>
          <h3 style={{ margin: 0, color: '#4f3e83' }}>🚀 Ready to visit your little lavender universe?</h3>
          <p style={{ margin: '6px 0 0', color: '#6f648d' }}>
            Create your account and manage classes, memberships, and party bookings in one playful dashboard.
          </p>
        </div>
        <Link href="/login" style={{ fontWeight: 800, color: '#4f3e83' }}>
          Go to Login →
        </Link>
      </section>
    </main>
  );
}
