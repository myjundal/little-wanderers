import Image from 'next/image';
import Link from 'next/link';

import styles from './Nav.module.css';

const LOGO_SRC = '/brand-mark.svg';

const navItems = [
  { href: '/#space', label: 'Space' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/#classes', label: 'Classes' },
  { href: '/faq', label: 'FAQ' },
  { href: '/#visit', label: 'Visit' },
  { href: '/login', label: 'Login' },
] as const;

export default function Nav() {
  return (
    <nav className={styles.navShell}>
      <div className={styles.navInner}>
        <Link href="/" className={styles.brand}>
          <span className={styles.brandMarkWrap}>
            <Image src={LOGO_SRC} alt="Little Wanderers logo" width={36} height={36} className={styles.brandMark} />
          </span>
          <span className={styles.brandCopy}>
            <strong>Little Wanderers</strong>
            <span>Sensory Play Café</span>
          </span>
        </Link>

        <div className={styles.menu}>
          {navItems.map((item) => (
            <Link key={item.label} href={item.href} className={styles.menuLink}>
              {item.label}
            </Link>
          ))}
        </div>

        <Link href="/#waitlist" className={styles.cta}>
          Join Waitlist
        </Link>
      </div>
    </nav>
  );
}
