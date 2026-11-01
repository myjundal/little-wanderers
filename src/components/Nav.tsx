import { PastelHeader } from '@/components/pastel/PastelPrimitives';
import { getCurrentUserRole, isStaffRole } from '@/lib/authz';
import { getWaitlistCount } from '@/lib/waitlist-count';

export default async function Nav() {
  const [identity, waitlistCount] = await Promise.all([
    getCurrentUserRole(),
    getWaitlistCount(),
  ]);

  return (
    <PastelHeader
      isAuthenticated={Boolean(identity.user)}
      dashboardHref={isStaffRole(identity.role) ? '/staff/dashboard' : identity.roles.includes('instructor') ? '/teaching' : undefined}
      accessLabel={isStaffRole(identity.role) ? 'Dashboard' : identity.roles.includes('instructor') ? 'Teaching Classes' : undefined}
      waitlistCount={{ displayCount: waitlistCount.displayCount }}
    />
  );
}
