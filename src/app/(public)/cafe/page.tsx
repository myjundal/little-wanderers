import Link from 'next/link';
import type { CSSProperties } from 'react';

export const metadata = {
  title: 'Cafe — Little Wanderers',
  description:
    'Cafe drinks, locally roasted Victus Coffee, and opening menu details at Little Wanderers Play Studio & Cafe in West Hartford, CT.',
};

const pageStyle: CSSProperties = {
  maxWidth: 980,
  margin: '20px auto',
  padding: 'clamp(20px, 4vw, 34px)',
  borderRadius: 32,
  border: '1px solid rgba(255,255,255,0.72)',
  background: 'linear-gradient(180deg, rgba(255,255,255,0.86) 0%, rgba(247,242,255,0.92) 100%)',
  boxShadow: '0 24px 50px rgba(123, 106, 168, 0.1)',
};

const eyebrowStyle: CSSProperties = {
  margin: 0,
  color: '#7b6aa8',
  fontSize: 13,
  fontWeight: 700,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
};

const sectionStyle: CSSProperties = {
  marginTop: 28,
  padding: 'clamp(20px, 4vw, 26px)',
  borderRadius: 28,
  background: 'rgba(255,255,255,0.64)',
  border: '1px solid rgba(255,255,255,0.76)',
  boxShadow: '0 16px 32px rgba(123, 106, 168, 0.06)',
};

const menuCardStyle: CSSProperties = {
  display: 'grid',
  gap: 12,
  alignContent: 'start',
  padding: 20,
  borderRadius: 22,
  background: 'rgba(251,248,255,0.94)',
  border: '1px solid rgba(235,227,250,0.96)',
  boxShadow: '0 12px 26px rgba(123, 106, 168, 0.07)',
};

const menuGroups = [
  {
    title: 'Espresso & Coffee',
    items: ['Espresso', 'Americano', 'Latte', 'Cappuccino'],
  },
  {
    title: 'Matcha',
    items: ['Matcha Latte - iced or hot'],
  },
  {
    title: (
      <>
        Little Wanderers
        <br />
        Specials
      </>
    ),
    key: 'Little Wanderers Specials',
    items: ['Strawberry Hibiscus Tea', 'Lavender Cloud Milk'],
  },
];

export default function CafePage() {
  return (
    <main style={pageStyle}>
      <section style={{ display: 'grid', gap: 16, borderRadius: 0 }}>
        <p style={eyebrowStyle}>Cafe</p>
        <h1 style={{ margin: 0, color: '#4b4360', fontSize: 'clamp(2.35rem, 5vw, 3.55rem)', lineHeight: 1.06 }}>
          A cozy pause for grown-ups and little treats for wanderers.
        </h1>
        <p style={{ margin: 0, color: '#7e7695', maxWidth: 780, fontSize: '1.05rem', lineHeight: 1.75 }}>
          Our cafe will serve thoughtfully made drinks alongside locally roasted{' '}
          <Link href="https://victuscoffee.com/" target="_blank" rel="noreferrer">
            Victus Coffee
          </Link>
          , whether you need a morning espresso, something refreshing, or a fun treat while the little ones play.
        </p>
      </section>

      <section style={sectionStyle}>
        <p style={eyebrowStyle}>A taste of what&apos;s coming</p>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 14,
            marginTop: 18,
          }}
        >
          {menuGroups.map((group) => (
            <article key={group.key ?? group.title} style={menuCardStyle}>
              <h2 style={{ margin: 0, color: '#4b4360', fontSize: '1.35rem' }}>{group.title}</h2>
              <ul style={{ display: 'grid', gap: 8, margin: 0, paddingLeft: 18, color: '#7e7695', lineHeight: 1.65 }}>
                {group.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>

      <section
        style={{
          display: 'grid',
          gap: 12,
          marginTop: 24,
          padding: 'clamp(20px, 4vw, 24px)',
          borderRadius: 24,
          background: 'rgba(255,255,255,0.58)',
          border: '1px solid rgba(255,255,255,0.72)',
        }}
      >
        <p style={{ margin: 0, color: '#4b4360', fontWeight: 800 }}>Full menu coming soon.</p>
        <p style={{ margin: 0, color: '#7e7695', lineHeight: 1.75 }}>
          Additional drinks and grab-and-go snacks will be added as we get closer to opening.
        </p>
      </section>
    </main>
  );
}
