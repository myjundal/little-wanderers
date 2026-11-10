import { PastelHeader } from '@/components/pastel/PastelPrimitives';
import { getCurrentUserRole, isStaffRole } from '@/lib/authz';

export default async function Nav() {
  const identity = await getCurrentUserRole();

  return (
    <PastelHeader
      isAuthenticated={Boolean(identity.user)}
      dashboardHref={isStaffRole(identity.role) ? '/staff/dashboard' : identity.roles.includes('instructor') ? '/teaching' : undefined}
      accessLabel={isStaffRole(identity.role) ? 'Dashboard' : identity.roles.includes('instructor') ? 'Teaching Classes' : undefined}
    />
  );
}
