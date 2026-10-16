import { PastelHeader } from '@/components/pastel/PastelPrimitives';
import { getCurrentUserRole } from '@/lib/authz';
import { getWaitlistCount } from '@/lib/waitlist-count';

export default async function Nav() {
  const [identity, waitlistCount] = await Promise.all([
    getCurrentUserRole(),
    getWaitlistCount(),
  ]);

  return (
    <PastelHeader
      isAuthenticated={Boolean(identity.user)}
      dashboardHref={identity.isKiosk ? '/staff-login' : undefined}
      accessLabel={identity.isKiosk ? 'Staff Dashboard / Clock out' : undefined}
      waitlistCount={{ displayCount: waitlistCount.displayCount }}
    />
  );
}
