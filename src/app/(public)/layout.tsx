import type { ReactNode } from 'react';
import Nav from '@/components/Nav';
import { PastelPageShell } from '@/components/pastel/PastelShells';

export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Nav />
      <PastelPageShell>{children}</PastelPageShell>
    </>
  );
}
