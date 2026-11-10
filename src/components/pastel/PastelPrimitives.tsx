import Link from 'next/link';
import Image from 'next/image';
import type { ReactNode } from 'react';
import styles from './pastel.module.css';
import PublicMoreMenu from './PublicMoreMenu';

export function PastelButton({
  href,
  children,
  secondary = false,
  external = false,
  className,
}: {
  href: string;
  children: ReactNode;
  secondary?: boolean;
  external?: boolean;
  className?: string;
}) {
  const buttonClassName = [secondary ? styles.buttonSecondary : styles.buttonPrimary, className]
    .filter(Boolean)
    .join(' ');

  return (
    <Link href={href} className={buttonClassName} target={external ? '_blank' : undefined} rel={external ? 'noreferrer' : undefined}>
      {children}
    </Link>
  );
}

export function PastelCard({ children }: { children: ReactNode }) {
  return <div className={styles.card}>{children}</div>;
}

export function PastelHeader({ isAuthenticated = false, dashboardHref, accessLabel }: { isAuthenticated?: boolean; dashboardHref?: string; accessLabel?: string }) {
  return <header className={styles.header}>
    <Link href="/" className={styles.logoWrap} aria-label="Little Wanderers home">
      <Image src="/logo.png" alt="" width={52} height={52} className={styles.logo} priority />
      <div className={styles.wordmark}><strong>Little Wanderers</strong><span>Play Studio &amp; Cafe</span></div>
    </Link>
    <nav className={styles.navOnlyFaq} aria-label="Main navigation">
      <Link href="/pricing">Pricing</Link><Link href="/classes">Classes</Link><Link href="/party">Parties</Link><Link href="/visit-us">Visit us</Link>
      <PublicMoreMenu />
    </nav>
    <div className={styles.headerActions}>
      <Link className={styles.accountLink} href={dashboardHref ?? (isAuthenticated ? '/landing' : '/login')}>{accessLabel ?? (isAuthenticated ? 'My account' : 'Sign in')}</Link>
      <Link className={styles.reserveButton} href="/soft-opening">Reserve a visit</Link>
    </div>
  </header>;
}
