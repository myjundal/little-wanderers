import Image from 'next/image';
import Link from 'next/link';

export const metadata = {
  title: 'Little Wanderers — Sensory-filled Learning Play Adventure',
  description: 'Play, learn, and wander in West Hartford.',
};

const LOGO_SRC = '/brand-mark.svg';

const featureCards = [
  {
    title: 'Calm Sensory Environment',
    body: 'Thoughtful lighting, open movement flow, and gentle transitions help children feel safe, curious, and confident.',
  },
  {
    title: 'Parent-Friendly Experience',
    body: 'From first visit to memberships and classes, everything is clear, warm, and easy to manage.',
  },
  {
    title: 'Beautiful + Reliable',
    body: 'A dreamy visual identity supported by professional operations, check-ins, and booking systems.',
  },
];

export default function HomePage() {
  return (
    <main style={{ maxWidth: 1160, margin: '20px auto', padding: 28 }}>
      <section style={{ display: 'grid', gap: 16 }}>
        <div
          style={{
            padding: 12,
            borderRadius: 18,
            border: '1px solid #e7daf9',
            background: 'linear-gradient(180deg, #ffffff, #f4ecff)',
          }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(320px, 1.1fr) minmax(260px, 0.9fr)',
              gap: 18,
              alignItems: 'center',
            }}
          >
            <div style={{ padding: 14 }}>
              <span
                style={{
                  display: 'inline-block',
                  border: '1px solid #d7c6f4',
                  borderRadius: 999,
                  padding: '6px 12px',
                  fontSize: 12,
                  fontWeight: 700,
                  color: '#66509d',
                  background: '#fff',
                  letterSpacing: '0.04em',
                }}
              >
                WEST HARTFORD · SENSORY LEARNING PLAY
              </span>

              <h1 style={{ fontSize: 44, lineHeight: 1.1, margin: '14px 0 10px', maxWidth: 620 }}>
                Wonder-filled play for children,
                <br />
                beautifully organized for parents.
              </h1>

              <p style={{ margin: 0, color: '#6f628d', fontSize: 18, maxWidth: 620 }}>
                Little Wanderers combines sensory play, imagination, and movement in a soft lavender space inspired by
                your fox-and-planet brand world.
              </p>

              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 18 }}>
                <Link
                  href="/login"
                  style={{
                    background: 'linear-gradient(180deg,#c8b2ef,#a684de)',
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

            <div style={{ padding: 8 }}>
              <div
                style={{
                  borderRadius: 20,
                  border: '1px solid #e4d7f9',
                  background: '#fff',
                  boxShadow: '0 20px 40px rgba(124, 95, 183, 0.16)',
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
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 12 }}>
          {featureCards.map((card) => (
            <article
              key={card.title}
              style={{
                border: '1px solid #e8dbfb',
                borderRadius: 16,
                background: '#fff',
                padding: 16,
                minWidth: 0,
              }}
            >
              <h3 style={{ margin: 0, fontSize: 20 }}>{card.title}</h3>
              <p style={{ margin: '8px 0 0', color: '#6f648d' }}>{card.body}</p>
            </article>
          ))}
        </div>

        <div
          style={{
            border: '1px solid #e8dbfb',
            borderRadius: 16,
            background: 'linear-gradient(120deg,#ffffff,#f4ecff)',
            padding: 16,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 12,
          }}
        >
          <div>
            <h3 style={{ margin: 0 }}>Ready for your first visit?</h3>
            <p style={{ margin: '6px 0 0', color: '#6f648d' }}>
              Create your account and manage classes, memberships, and party booking requests in one place.
            </p>
          </div>
          <Link href="/login" style={{ fontWeight: 800 }}>
            Go to Login →
          </Link>
        </div>
      </section>
    </main>
  );
}
