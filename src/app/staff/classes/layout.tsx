import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { getCurrentUserRole, isStaffRole } from '@/lib/authz';
export default async function StaffClassesLayout({ children }: { children: ReactNode }) {
  const { role } = await getCurrentUserRole();
  if (!isStaffRole(role)) redirect('/staff');
  return <>{children}</>;
}
