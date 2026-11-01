'use client';

import { usePathname } from 'next/navigation';
import { useOperatorAccess } from '@/lib/use-owner-dashboard-access';
import { activeOperatorLink } from '@/lib/operator-navigation';
import StaffToolNav from './StaffToolNav';
import styles from './operator-navigation.module.css';

export default function StaffQuickNav() {
  const { canUseOwnerDashboard, isKiosk } = useOperatorAccess();
  const pathname = usePathname();
  if (!canUseOwnerDashboard) return null;
  return <><div className={styles.quickSpace} aria-hidden="true" /><StaffToolNav active={activeOperatorLink(pathname)} includePersonal={!isKiosk} variant="quick" /></>;
}
