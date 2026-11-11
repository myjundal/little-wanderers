import { getCurrentUserRole } from '@/lib/authz';
import OperatorDashboard from '@/components/staff/OperatorDashboard';
import { canViewRevenue } from '@/lib/revenue-access';

export default async function StaffHomePage() {
  const context = await getCurrentUserRole();
  return <OperatorDashboard role={context.role} roles={context.roles} isKiosk={context.isKiosk} canViewPrivateRevenue={canViewRevenue(context)} />;
}
