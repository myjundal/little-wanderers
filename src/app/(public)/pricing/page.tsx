import Link from 'next/link';

export const metadata = { title: 'Pricing — Little Wanderers' };

const pricingItems = [
  {
    title: 'First child',
    detail: '7 months+ · includes 2 adults',
    price: '$15',
  },
  {
    title: 'Sibling',
    detail: 'If a sibling is an infant, that sibling is free',
    price: '$10',
  },
  {
    title: '1 infant',
    detail: '0–6 months · includes 2 adults',
    price: '$8',
  },
];

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
      <h1 style={{ margin: '14px 0 0', color: '#4b4360', fontSize: 'clamp(2.3rem, 5vw, 3.4rem)' }}>Simple pricing for a softer play day.</h1>
      <p style={{ margin: '18px 0 0', color: '#7e7695', maxWidth: 700, lineHeight: 1.75 }}>
        A calm, easy structure for families visiting Little Wanderers in West Hartford.
      </p>

      <section
        style={{
          marginTop: 28,
          display: 'grid',
          gap: 16,
        }}
      >
        {pricingItems.map((item) => (
          <article
            key={item.title}
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 1fr) auto',
              gap: 16,
              alignItems: 'center',
              padding: 22,
              borderRadius: 26,
              background: 'rgba(255,255,255,0.78)',
              border: '1px solid rgba(255,255,255,0.74)',
              boxShadow: '0 16px 32px rgba(123, 106, 168, 0.08)',
            }}
          >
            <div>
              <h2 style={{ margin: 0, color: '#4b4360', fontSize: '1.35rem' }}>{item.title}</h2>
              <p style={{ margin: '8px 0 0', color: '#7e7695', lineHeight: 1.65 }}>{item.detail}</p>
            </div>
            <strong style={{ color: '#7b6aa8', fontSize: '1.85rem', whiteSpace: 'nowrap' }}>{item.price}</strong>
          </article>
        ))}
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
          Infant siblings are free when listed under the sibling option. For the latest updates and opening info, you can also{' '}
          <Link href="https://forms.gle/ucr5SGqiX6A6TJ8K7" target="_blank" rel="noreferrer">
            join the waitlist here
          </Link>
          .
        </p>
      </section>
    </main>
  );
}
