import Link from 'next/link';

import styles from './Nav.module.css';

const WAITLIST_URL = 'https://forms.gle/ucr5SGqiX6A6TJ8K7';

const navItems = [
  { href: '/space', label: 'Space' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/classes', label: 'Classes' },
  { href: '/faq', label: 'FAQ' },
  { href: '/visit', label: 'Visit' },
  { href: '/login', label: 'Login' },
] as const;

export default function Nav() {
  return (
    <nav className={styles.navShell}>
      <div className={styles.navInner}>
        <Link href="/" className={styles.brand}>
          <span className={styles.brandCopy}>
            <strong>Little Wanderers</strong>
            <span>Sensory Studio and Cafe</span>
          </span>
        </Link>

        <div className={styles.menu}>
          {navItems.map((item) => (
            <Link key={item.label} href={item.href} className={styles.menuLink}>
              {item.label}
            </Link>
          ))}
        </div>

        <Link href={WAITLIST_URL} className={styles.cta} target="_blank" rel="noreferrer">
          Join Waitlist
        </Link>
      </div>
    </nav>
  );
}
