import { Suspense, type ReactNode } from 'react';
import Nav from '@/components/Nav';
import { PastelPageShell } from '@/components/pastel/PastelShells';
import { PastelHeader } from '@/components/pastel/PastelPrimitives';

export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Suspense fallback={<PastelHeader />}><Nav /></Suspense>
      <PastelPageShell>{children}</PastelPageShell>
    </>
  );
}
