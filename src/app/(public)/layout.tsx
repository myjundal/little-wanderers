import type { ReactNode } from 'react';
import Nav from '@/components/Nav';

export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Nav />
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '0 20px 28px' }}>{children}</div>
    </>
  );
}
