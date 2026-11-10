'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import type { ReactNode } from 'react';
import styles from './founding.module.css';

const membershipPath = /^\/(?:wanderlist-founding|general-founding|founding-membership(?:\/(?:public|waitlist))?)$/;

export default function FoundingHeader({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isMembership = membershipPath.test(pathname) || pathname === '/login';
  if (!isMembership) return children;
  return <header className={styles.checkoutHeader}>
    <Link href="/" className={styles.brand}><Image src="/logo.png" alt="Little Wanderers logo" width={40} height={40} priority /><strong>Little Wanderers</strong></Link>
    <Link href="/contact">Need help?</Link>
  </header>;
}
