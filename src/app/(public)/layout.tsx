import { Suspense, type ReactNode } from 'react';
import Nav from '@/components/Nav';
import FoundingHeader from '@/components/membership/FoundingHeader';
import { PastelPageShell } from '@/components/pastel/PastelShells';
import { PastelHeader } from '@/components/pastel/PastelPrimitives';

export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Suspense fallback={<PastelHeader />}><FoundingHeader><Nav /></FoundingHeader></Suspense>
      <PastelPageShell>{children}</PastelPageShell>
    </>
  );
}
