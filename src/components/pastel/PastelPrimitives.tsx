import Link from 'next/link';
import Image from 'next/image';
import type { ReactNode } from 'react';
import styles from './pastel.module.css';

export function PastelButton({ href, children, secondary = false, external = false }: { href: string; children: ReactNode; secondary?: boolean; external?: boolean }) {
  return (
    <Link href={href} className={secondary ? styles.buttonSecondary : styles.buttonPrimary} target={external ? '_blank' : undefined} rel={external ? 'noreferrer' : undefined}>
      {children}
    </Link>
  );
}

export function PastelCard({ children }: { children: ReactNode }) {
  return <div className={styles.card}>{children}</div>;
}

export function PastelHeader() {
  return (
    <header className={styles.header}>
      <Link href="/" className={styles.logoWrap}>
        <Image src="/logo.png" alt="Little Wanderers logo" width={220} height={64} className={styles.logo} priority />
      </Link>
      <nav className={styles.nav}>
        <Link href="/space">Play</Link>
        <Link href="/classes">Classes</Link>
        <Link href="/party">Parties</Link>
        <Link href="/pricing">Membership</Link>
        <Link href="/visit">Visit</Link>
      </nav>
      <PastelButton href="https://forms.gle/ucr5SGqiX6A6TJ8K7" external>
        Join Waitlist
      </PastelButton>
    </header>
  );
}
