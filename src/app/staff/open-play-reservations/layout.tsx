import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { getCurrentUserRole, isStaffRole } from '@/lib/authz';
export default async function StaffOnlyLayout({ children }: { children: ReactNode }) {
  const { role } = await getCurrentUserRole();
  if (!isStaffRole(role)) redirect('/staff');
  return <>{children}</>;
}
