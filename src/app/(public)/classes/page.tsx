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
      <PublicUpcomingClasses />
    </main>
  );
}
