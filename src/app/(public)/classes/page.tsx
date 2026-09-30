import type { CSSProperties } from 'react';

import PublicUpcomingClasses from '@/components/classes/PublicUpcomingClasses';

export const metadata = {
  title: 'Classes & Programs — Little Wanderers',
  description:
    'Small-group classes and children’s programs at Little Wanderers Play Studio & Cafe in West Hartford, CT.',
};

const pageStyle = {
  maxWidth: 1080,
  margin: '20px auto',
  padding: 'clamp(20px, 4vw, 34px)',
  borderRadius: 32,
  border: '1px solid rgba(255,255,255,0.72)',
  background: 'linear-gradient(180deg, rgba(255,255,255,0.86) 0%, rgba(247,242,255,0.92) 100%)',
  boxShadow: '0 24px 50px rgba(123, 106, 168, 0.1)',
} satisfies CSSProperties;

export default function ClassesPage() {
  return (
    <main style={pageStyle}>
      <section style={{ marginBottom: 24 }}>
        <p style={{ margin: '0 0 8px', color: '#7b6aa8', fontSize: 13, fontWeight: 900, letterSpacing: 0, textTransform: 'uppercase' }}>
          Classes & Events
        </p>
        <h1 style={{ margin: 0, color: '#4b4360', fontSize: 'clamp(2rem, 5vw, 3.7rem)', lineHeight: 1.05 }}>
          Little Wanderers Classes & Events
        </h1>
        <p style={{ maxWidth: 740, margin: '14px 0 0', color: '#6f628d', fontSize: '1.05rem', lineHeight: 1.75 }}>
          Playful small-group programs for curious kids and families. Browse what is opening first, then use My Little Wanderers to get early access to class pre-registration.
        </p>
      </section>
      <PublicUpcomingClasses />
    </main>
  );
}
