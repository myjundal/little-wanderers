'use client';

import Link from 'next/link';
import { operatorLinks, operatorQuickLinks, personalBookingLinks, instructorLinks, membershipManagementLink } from '@/lib/operator-navigation';
import styles from './operator-navigation.module.css';

type StaffToolNavProps = {
  active?: string;
  audience?: 'operator' | 'instructor';
  includePersonal?: boolean;
  includeMembershipManagement?: boolean;
  variant?: 'tools' | 'dashboard' | 'menu' | 'quick';
  onNavigate?: () => void;
};

export default function StaffToolNav({ active, audience = 'operator', includePersonal = false, includeMembershipManagement = false, variant = 'tools', onNavigate }: StaffToolNavProps) {
  const links = (items: ReadonlyArray<{ id: string; href: string; label: string }>) => items.map(item => (
    <Link key={item.id} href={item.href} onClick={onNavigate} aria-current={active === item.id ? 'page' : undefined} className={styles.link}>
      {item.label}
    </Link>
  ));

  return <nav aria-label={variant === 'quick' ? 'Quick menu' : audience === 'instructor' ? 'Instructor menu' : 'Staff and owner menu'} className={`${styles.navigation} ${styles[variant]}`}>
    <div className={styles.primary}>{links(audience === 'instructor' ? instructorLinks : variant === 'quick' ? operatorQuickLinks : operatorLinks)}{includeMembershipManagement && audience === 'operator' && variant !== 'quick' && links([membershipManagementLink])}</div>
    {includePersonal && variant !== 'quick' && <div className={styles.personal} aria-label="My bookings">{links(personalBookingLinks)}</div>}
  </nav>;
}
