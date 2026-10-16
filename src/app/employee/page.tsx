import { redirect } from 'next/navigation';
import { getCurrentUserRole, isStaffRole } from '@/lib/authz';
import StaffAccount from '@/components/staff/StaffAccount';
import StaffSessionBar from '@/components/staff/StaffSessionBar';
import LandingMoreMenu from '@/components/landing/LandingMoreMenu';
import { PastelDashboardShell } from '@/components/pastel/PastelShells';
export default async function EmployeePage() {
  const { user, role, roles } = await getCurrentUserRole();
  if (!user) redirect('/login');
  if (!isStaffRole(role) && !roles.includes('instructor')) redirect('/landing');
  return <PastelDashboardShell><LandingMoreMenu /><StaffSessionBar /><StaffAccount /></PastelDashboardShell>;
}
