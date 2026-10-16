import LandingMoreMenu from '@/components/landing/LandingMoreMenu';
import StaffSessionBar from '@/components/staff/StaffSessionBar';
import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { getCurrentUserRole, isStaffRole } from '@/lib/authz';
import { PastelDashboardShell } from '@/components/pastel/PastelShells';

export default async function StaffLayout({ children }: { children: ReactNode }) {
  const { user, role } = await getCurrentUserRole();

  if (!user) {
    redirect('/login');
  }

  if (!isStaffRole(role)) {
    redirect('/landing');
  }

  return <PastelDashboardShell><LandingMoreMenu /><StaffSessionBar />{children}</PastelDashboardShell>;
}
