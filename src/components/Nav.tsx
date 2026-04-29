import Link from 'next/link';
import Image from 'next/image';

import styles from './Nav.module.css';

const WAITLIST_URL = 'https://forms.gle/ucr5SGqiX6A6TJ8K7';

const navItems = [{ href: '/faq', label: 'FAQ' }] as const;

export default function Nav() {
  return (
    <nav className={styles.navShell}>
      <div className={styles.navInner}>
        <Link href="/" className={styles.brand}>
          <Image src="/logo.png" alt="Little Wanderers logo" width={240} height={70} className={styles.brandLogo} priority />
        </Link>

        <div className={styles.menu}>
          {navItems.map((item) => (
            <Link key={item.label} href={item.href} className={styles.menuLink}>
              {item.label}
            </Link>
          ))}
        </div>

        <Link href={WAITLIST_URL} className={styles.cta} target="_blank" rel="noreferrer">
          <span>Join Waitlist</span>
          <span className={styles.ctaSubtext}>Over 270+ local families already signed up</span>
        </Link>
      </div>
    </nav>
  );
}
