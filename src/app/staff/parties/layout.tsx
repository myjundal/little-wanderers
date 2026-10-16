import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { getCurrentUserRole } from '@/lib/authz';
export default async function OwnerOnlyLayout({ children }: { children: ReactNode }) {
  const { role } = await getCurrentUserRole();
  if (role !== 'owner' && role !== 'admin') redirect('/staff');
  return <>{children}</>;
}
