import Image from 'next/image';
import Link from 'next/link';

import styles from '@/app/(public)/home.module.css';

const LOGO_SRC = '/brand-mark.svg';
const WAITLIST_URL = 'https://forms.gle/ucr5SGqiX6A6TJ8K7';

export default function HomeComingSoon() {
  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.heroGlowLeft} />
        <div className={styles.heroGlowRight} />

        <div style={{ position: 'relative', zIndex: 1 }}>
          <div className={styles.heroCopy}>
            <div className={styles.titleLockup}>
              <Image
                src={LOGO_SRC}
                alt="Little Wanderers brand mark"
                width={162}
                height={162}
                className={styles.titleLogo}
                priority
              />
              <div className={styles.titleCopy}>
                <p className={styles.brandLine}>Little Wanderers: West Hartford</p>
                <h1>Coming soon in Summer 2026</h1>
              </div>
            </div>
            <p className={styles.subtitle}>
              A calm, dreamy space designed and crafted for 0-7 year olds for sensory exploration, plus a break in
              the day and coffee-in-hand moments that feel restorative for parents too.
            </p>
            <p className={styles.subline}>Join waitlist for updates and early access!</p>

            <div className={styles.ctaRow}>
              <Link href={WAITLIST_URL} className={styles.primaryBtn} target="_blank" rel="noreferrer">
                Join Waitlist
              </Link>
              <Link href="/faq" className={styles.secondaryBtn}>
                FAQ
              </Link>
            </div>

            <div className={styles.chips}>
              <span>✦ sensory-led</span>
              <span>☾ calm</span>
              <span>♡ breathe</span>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
