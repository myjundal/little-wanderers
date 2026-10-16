import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { getCurrentUserRole } from '@/lib/authz';
import { PastelDashboardShell } from '@/components/pastel/PastelShells';
import LandingMoreMenu from '@/components/landing/LandingMoreMenu';

export default async function TeachingLayout({ children }: { children: ReactNode }) {
  const { user, roles, role } = await getCurrentUserRole();
  if (!user) redirect('/login');
  if (!roles.includes('instructor') && role !== 'owner' && role !== 'admin') redirect('/landing');
  return <PastelDashboardShell><LandingMoreMenu />{children}</PastelDashboardShell>;
}
