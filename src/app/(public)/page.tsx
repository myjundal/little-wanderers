import Image from 'next/image';
import Link from 'next/link';

import styles from './home.module.css';
import CrowdLevelCard from '@/components/crowd/CrowdLevelCard';

export const metadata = {
  title: 'Little Wanderers — Sensory-focused Studio and Cafe',
  description: 'Wander, play, and grow in Little Wanderers',
};

const LOGO_SRC = '/brand-mark.svg';
const WAITLIST_URL = 'https://forms.gle/ucr5SGqiX6A6TJ8K7';

export default function HomePage() {
  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.heroGlowLeft} />
        <div className={styles.heroGlowRight} />

        <div className={styles.heroGrid}>
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
                <h1>Take a breath while little wanderers explore a sensory adventure.</h1>
              </div>
            </div>
            <p className={styles.subtitle}>
              A calm, dreamy space designed and crafted for 0-7 year olds for sensory exploration, plus a break in
              the day and coffee-in-hand moments that feel restorative for parents too.
            </p>
            <p className={styles.subline}>Take a deep breath and a sip of your drink.</p>

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

          <aside className={styles.heroVisual}>
            <CrowdLevelCard compact style={{ maxWidth: '100%' }} />
            <div className={styles.visualCard} aria-label="Today at Little Wanderers placeholder">
              <span className={styles.visualEyebrow}>Today at Little Wanderers</span>
              <div className={styles.placeholderList}>
                <p>Today&apos;s sensory material:</p>
                <p>Today&apos;s class:</p>
                <p>Scheduled party:</p>
              </div>
            </div>
          </aside>
        </div>
      </section>
    </main>
  );
}
