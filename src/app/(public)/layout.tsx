import type { ReactNode } from 'react';
import Nav from '@/components/Nav';

export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Nav />
      <div style={{ maxWidth: 960, margin: '0 auto', padding: '16px' }}>{children}</div>
    </>
  );
}
