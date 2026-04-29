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
        <Image src="/logo.png" alt="Little Wanderers logo" width={72} height={72} className={styles.logo} priority />
        <div className={styles.wordmark}>
          <strong>Little Wanderers</strong>
          <span>Sensory Play Studio and Cafe</span>
        </div>
      </Link>

      <nav className={styles.navOnlyFaq}>
        <Link href="/faq">FAQ</Link>
      </nav>

      <PastelButton href="https://forms.gle/ucr5SGqiX6A6TJ8K7" external>
        <span>Join waitlist</span>
        <small>(Over 280+ local families already joined)</small>
      </PastelButton>
    </header>
  );
}
