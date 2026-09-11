import type { CSSProperties } from 'react';

import PublicUpcomingClasses from '@/components/classes/PublicUpcomingClasses';

export const metadata = {
  title: 'Classes & Programs — Little Wanderers',
  description:
    'Small-group classes and children’s programs at Little Wanderers Play Studio & Cafe in West Hartford, CT.',
};

const pageStyle: CSSProperties = {
  maxWidth: 1080,
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

const programCardStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  minHeight: 72,
  padding: '16px 18px',
  borderRadius: 20,
  background: 'rgba(251,248,255,0.94)',
  border: '1px solid rgba(235,227,250,0.96)',
  color: '#4b4360',
  fontWeight: 800,
  lineHeight: 1.35,
};

const programs = [
  'Ballet & Movement',
  'Art',
  'Music & Movement',
  'Spanish',
  'Yoga',
  'Other baby & toddler programs',
];

export default function ClassesPage() {
  return (
    <main style={pageStyle}>
      <section style={{ display: 'grid', gap: 16, borderRadius: 0 }}>
        <p style={eyebrowStyle}>Classes & Programs</p>
        <h1 style={{ margin: 0, color: '#4b4360', fontSize: 'clamp(2.35rem, 5vw, 3.55rem)', lineHeight: 1.06 }}>
          Little classes for big curiosity.
        </h1>
        <p style={{ margin: 0, color: '#7e7695', maxWidth: 760, fontSize: '1.05rem', lineHeight: 1.75 }}>
          Little Wanderers will offer small-group classes designed for little wanderers to move, create, explore, and
          learn in a calm, cozy play studio setting.
        </p>
        <p style={{ margin: 0, color: '#7e7695', maxWidth: 760, lineHeight: 1.75 }}>
          Class schedules and registration will be released as instructors and times are finalized.
        </p>
        <p
          style={{
            display: 'inline-flex',
            width: 'fit-content',
            margin: 0,
            padding: '8px 14px',
            borderRadius: 999,
            background: '#f3ecfb',
            color: '#7b6aa8',
            border: '1px solid #dfd1ef',
            fontWeight: 800,
          }}
        >
          Coming soon!
        </p>
      </section>

      <section style={sectionStyle}>
        <p style={eyebrowStyle}>Opening lineup</p>
        <p style={{ margin: '12px 0 0', color: '#7e7695', lineHeight: 1.75 }}>
          Our opening lineup will include programs like these, offered across various age groups as the schedule comes
          together.
        </p>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
            gap: 12,
            marginTop: 18,
          }}
        >
          {programs.map((program) => (
            <article key={program} style={programCardStyle}>
              {program}
            </article>
          ))}
        </div>
      </section>

      <PublicUpcomingClasses />
    </main>
  );
}
