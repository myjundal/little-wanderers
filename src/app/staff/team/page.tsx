import { redirect } from 'next/navigation';
import { getCurrentUserRole } from '@/lib/authz';
import StaffTeam from '@/components/staff/StaffTeam';
export default async function TeamPage() {
  const { role } = await getCurrentUserRole();
  if (role !== 'owner' && role !== 'admin') redirect('/staff/dashboard');
  return <StaffTeam />;
}
