import type { CSSProperties } from 'react';
import Link from 'next/link';

export const metadata = { title: 'Pricing — Little Wanderers' };

const openPlayItems = [
  {
    title: 'First child',
    detail: '7 months+',
    price: '$15',
  },
  {
    title: 'Sibling',
    detail: 'If a sibling is an infant, that sibling is free',
    price: '$10',
  },
  {
    title: '1 infant',
    detail: '0–6 months',
    price: '$8',
  },
  {
    title: 'Additional adults',
    detail: 'For grownups beyond the included family adults',
    price: '$5',
  },
];

const membershipItems = [
  {
    title: 'Monthly membership',
    detail: '$60 per child · unlimited visits for one month',
  },
  {
    title: 'Included adults',
    detail: 'Up to 2 adults per family are included with each visit under the membership.',
  },
  {
    title: 'Sibling add-on',
    detail: 'Add a sibling membership for $30 per child.',
  },
  {
    title: 'Infant sibling note',
    detail: 'If a sibling is 6 months or younger, they are included in the $60 membership. Infant-only memberships are not offered.',
  },
];

const cardStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) auto',
  gap: 16,
  alignItems: 'center',
  padding: 22,
  borderRadius: 26,
  background: 'rgba(255,255,255,0.78)',
  border: '1px solid rgba(255,255,255,0.74)',
  boxShadow: '0 16px 32px rgba(123, 106, 168, 0.08)',
};

export default function PricingPage() {
  return (
    <main
      style={{
        maxWidth: 980,
        margin: '20px auto',
        padding: 28,
        borderRadius: 32,
        border: '1px solid rgba(255,255,255,0.7)',
        background: 'linear-gradient(180deg, rgba(255,255,255,0.82) 0%, rgba(246,241,255,0.92) 100%)',
        boxShadow: '0 24px 50px rgba(123, 106, 168, 0.1)',
      }}
    >
      <p
        style={{
          margin: 0,
          color: '#7b6aa8',
          fontSize: 13,
          fontWeight: 700,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
        }}
      >
        Pricing
      </p>
      <h1 style={{ margin: '14px 0 0', color: '#4b4360', fontSize: 'clamp(2.3rem, 5vw, 3.4rem)' }}>
        Simple pricing for a softer play day.
      </h1>
      <p style={{ margin: '18px 0 0', color: '#7e7695', maxWidth: 760, lineHeight: 1.75 }}>
        All open play visits are untimed. To help us keep the space comfortable and within capacity, we’d love for you
        to check the main page for how busy the studio feels before heading over.
      </p>

      <section style={{ marginTop: 30 }}>
        <p
          style={{
            margin: 0,
            color: '#7b6aa8',
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
          }}
        >
          Open Play
        </p>

        <div style={{ marginTop: 16, display: 'grid', gap: 16 }}>
          {openPlayItems.map((item) => (
            <article key={item.title} style={cardStyle}>
              <div>
                <h2 style={{ margin: 0, color: '#4b4360', fontSize: '1.35rem' }}>{item.title}</h2>
                <p style={{ margin: '8px 0 0', color: '#7e7695', lineHeight: 1.65 }}>{item.detail}</p>
              </div>
              <strong style={{ color: '#7b6aa8', fontSize: '1.85rem', whiteSpace: 'nowrap' }}>{item.price}</strong>
            </article>
          ))}
        </div>

        <p style={{ margin: '16px 4px 0', color: '#7e7695', lineHeight: 1.7 }}>
          Child pricing includes up to 2 adults per family, whether you&apos;re booking the $15 first-child visit or the
          $8 infant visit.
        </p>
      </section>

      <section
        style={{
          marginTop: 28,
          padding: 24,
          borderRadius: 28,
          background: 'rgba(255,255,255,0.62)',
          border: '1px solid rgba(255,255,255,0.72)',
          boxShadow: '0 16px 32px rgba(123, 106, 168, 0.06)',
        }}
      >
        <p
          style={{
            margin: 0,
            color: '#7b6aa8',
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
          }}
        >
          Monthly Membership
        </p>
        <h2 style={{ margin: '12px 0 0', color: '#4b4360', fontSize: '1.8rem' }}>$60 per child</h2>
        <p style={{ margin: '10px 0 0', color: '#7e7695', lineHeight: 1.75 }}>
          Unlimited visits for one month, with up to 2 adults per family included each time you come.
        </p>

        <div style={{ marginTop: 18, display: 'grid', gap: 14 }}>
          {membershipItems.map((item) => (
            <article
              key={item.title}
              style={{
                padding: 18,
                borderRadius: 22,
                background: 'rgba(251,248,255,0.92)',
                border: '1px solid rgba(235,227,250,0.95)',
              }}
            >
              <strong style={{ color: '#4b4360', display: 'block' }}>{item.title}</strong>
              <p style={{ margin: '8px 0 0', color: '#7e7695', lineHeight: 1.7 }}>{item.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section
        style={{
          marginTop: 24,
          padding: 22,
          borderRadius: 24,
          background: 'rgba(255,255,255,0.58)',
          border: '1px solid rgba(255,255,255,0.72)',
        }}
      >
        <p style={{ margin: 0, color: '#4b4360', fontWeight: 700 }}>Helpful note</p>
        <p style={{ margin: '8px 0 0', color: '#7e7695', lineHeight: 1.75 }}>
          Infant siblings are free when listed under the sibling option. For the latest updates and opening info, you
          can also{' '}
          <Link href="https://forms.gle/ucr5SGqiX6A6TJ8K7" target="_blank" rel="noreferrer">
            join the waitlist here
          </Link>
          .
        </p>
      </section>
    </main>
  );
}
