import type { CSSProperties } from 'react';

export const metadata = {
  title: 'Membership — Little Wanderers',
  description: 'Monthly membership details for Little Wanderers Play Studio & Cafe in West Hartford, CT.',
};

const pageStyle: CSSProperties = {
  maxWidth: 980,
  margin: '20px auto',
  padding: 'clamp(20px, 4vw, 34px)',
  borderRadius: 32,
  border: '1px solid rgba(255,255,255,0.7)',
  background: 'linear-gradient(180deg, rgba(255,255,255,0.84) 0%, rgba(247,242,255,0.92) 100%)',
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

const priceCardStyle: CSSProperties = {
  display: 'grid',
  gap: 8,
  alignContent: 'start',
  minHeight: 176,
  padding: 22,
  borderRadius: 24,
  background: 'rgba(255,255,255,0.76)',
  border: '1px solid rgba(232,223,239,0.92)',
  boxShadow: '0 16px 32px rgba(123, 106, 168, 0.07)',
};

const includeCardStyle: CSSProperties = {
  padding: 18,
  borderRadius: 20,
  background: 'rgba(251,248,255,0.92)',
  border: '1px solid rgba(235,227,250,0.95)',
  color: '#4b4360',
  fontWeight: 700,
  lineHeight: 1.55,
};

const membershipIncludes = [
  'Unlimited open play during regular open play hours',
  'Up to two accompanying adults included with each visit',
  'Priority registration for select classes and special events',
];

export default function MembershipPage() {
  return (
    <main style={pageStyle}>
      <section style={{ display: 'grid', gap: 18, borderRadius: 0 }}>
        <p style={eyebrowStyle}>Membership</p>
        <div style={{ display: 'grid', gap: 16 }}>
          <h1 style={{ margin: 0, color: '#4b4360', fontSize: 'clamp(2.35rem, 5vw, 3.5rem)', lineHeight: 1.08 }}>
            Wander often?
          </h1>
          <p style={{ margin: 0, color: '#7e7695', maxWidth: 760, fontSize: '1.05rem', lineHeight: 1.75 }}>
            Our monthly membership is designed for families who want to make Little Wanderers part of their regular
            routine: easy open play days, familiar little rhythms, and a cozy place to return to together.
          </p>
        </div>
      </section>

      <section
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 16,
          marginTop: 28,
          borderRadius: 0,
        }}
      >
        <article style={priceCardStyle}>
          <p style={eyebrowStyle}>First child</p>
          <strong style={{ color: '#7b6aa8', fontSize: '2.45rem', lineHeight: 1 }}>$60</strong>
          <p style={{ margin: 0, color: '#7e7695', lineHeight: 1.6 }}>per month</p>
        </article>

        <article style={priceCardStyle}>
          <p style={eyebrowStyle}>Sibling add-on</p>
          <strong style={{ color: '#7b6aa8', fontSize: '2.45rem', lineHeight: 1 }}>$20</strong>
          <p style={{ margin: 0, color: '#7e7695', lineHeight: 1.6 }}>per month for each sibling 6 months or older</p>
        </article>

        <article style={priceCardStyle}>
          <p style={eyebrowStyle}>Baby sibling</p>
          <strong style={{ color: '#7b6aa8', fontSize: '1.55rem', lineHeight: 1.12 }}>No additional charge</strong>
          <p style={{ margin: 0, color: '#7e7695', lineHeight: 1.6 }}>
            Babies under 6 months may be added to an existing sibling membership.
          </p>
        </article>
      </section>

      <section
        style={{
          marginTop: 28,
          padding: 'clamp(20px, 4vw, 26px)',
          borderRadius: 28,
          background: 'rgba(255,255,255,0.62)',
          border: '1px solid rgba(255,255,255,0.72)',
          boxShadow: '0 16px 32px rgba(123, 106, 168, 0.06)',
        }}
      >
        <p style={eyebrowStyle}>Membership includes</p>
        <div style={{ display: 'grid', gap: 12, marginTop: 16 }}>
          {membershipIncludes.map((item) => (
            <article key={item} style={includeCardStyle}>
              {item}
            </article>
          ))}
        </div>
      </section>

      <section
        style={{
          display: 'grid',
          gap: 14,
          marginTop: 24,
          padding: 'clamp(20px, 4vw, 24px)',
          borderRadius: 24,
          background: 'rgba(255,255,255,0.58)',
          border: '1px solid rgba(255,255,255,0.72)',
        }}
      >
        <p style={{ margin: 0, color: '#4b4360', fontWeight: 800 }}>A few details</p>
        <p style={{ margin: 0, color: '#7e7695', lineHeight: 1.75 }}>
          Memberships are billed monthly and automatically renew until cancelled or paused.
        </p>
        <p style={{ margin: 0, color: '#7e7695', lineHeight: 1.75 }}>
          Membership admission is always subject to Little Wanderers&apos; occupancy and safety limits. Priority
          registration does not guarantee admission once the facility has reached maximum capacity.
        </p>
        <p style={{ margin: 0, color: '#7e7695', lineHeight: 1.75 }}>
          When a child on an existing membership turns 6 months old, the $20 sibling rate will begin with the following
          billing cycle.
        </p>
      </section>
    </main>
  );
}
