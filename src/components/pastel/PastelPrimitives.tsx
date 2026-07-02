import Link from 'next/link';
import Image from 'next/image';
import type { ReactNode } from 'react';
import WaitlistCountCard from '@/components/home/WaitlistCountCard';
import type { WaitlistDisplayCount } from '@/lib/waitlist-count';
import styles from './pastel.module.css';

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

export function PastelHeader({ isAuthenticated = false, waitlistCount }: { isAuthenticated?: boolean; waitlistCount?: WaitlistDisplayCount }) {
  return (
    <header className={styles.header}>
      <Link href="/" className={styles.logoWrap}>
        <Image src="/logo.png" alt="Little Wanderers logo" width={72} height={72} className={styles.logo} priority />
        <div className={styles.wordmark}>
          <strong>Little Wanderers</strong>
          <span>Sensory Play Studio and Cafe</span>
        </div>
      </Link>

      <nav className={styles.navOnlyFaq}>
        <Link href="/party">Party Booking</Link>
        <Link href="/faq">FAQ</Link>
        <Link href="/visit-us">Find Us</Link>
        <Link href="/contact">Say Hello</Link>
      </nav>

      <div className={styles.headerActions}>
        <PastelButton href={isAuthenticated ? '/landing' : '/login'} className={styles.accessButton}>
          <span>My Little Wanderers</span>
        </PastelButton>
        <div className={styles.waitlistCluster}>
          <PastelButton href="https://forms.gle/ucr5SGqiX6A6TJ8K7" external>
            <span>Join waitlist</span>
          </PastelButton>
          {waitlistCount && <WaitlistCountCard initialCount={waitlistCount} variant="compact" />}
        </div>
      </div>
    </header>
  );
}
