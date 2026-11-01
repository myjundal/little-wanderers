import { getCurrentUserRole } from '@/lib/authz';
import OperatorDashboard from '@/components/staff/OperatorDashboard';

export default async function StaffHomePage() {
  const { role, roles, isKiosk } = await getCurrentUserRole();
  return <OperatorDashboard role={role} roles={roles} isKiosk={isKiosk} />;
}
