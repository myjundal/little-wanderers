'use client';

import { usePathname } from 'next/navigation';
import { useOperatorAccess } from '@/lib/use-owner-dashboard-access';
import { activeOperatorLink, activeInstructorLink } from '@/lib/operator-navigation';
import StaffToolNav from './StaffToolNav';
import styles from './operator-navigation.module.css';

export default function StaffQuickNav() {
  const { canUseOwnerDashboard, isInstructor } = useOperatorAccess();
  const pathname = usePathname();
  if (!canUseOwnerDashboard && !isInstructor) return null;
  return <><div className={styles.quickSpace} aria-hidden="true" /><StaffToolNav active={canUseOwnerDashboard ? activeOperatorLink(pathname) : activeInstructorLink(pathname)} audience={canUseOwnerDashboard ? 'operator' : 'instructor'} variant="quick" /></>;
}
