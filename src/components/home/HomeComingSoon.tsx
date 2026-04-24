import Image from 'next/image';
import Link from 'next/link';

import styles from '@/app/(public)/home.module.css';

const LOGO_SRC = '/brand-mark.svg';
const WAITLIST_URL = 'https://forms.gle/ucr5SGqiX6A6TJ8K7';

export default function HomeComingSoon() {
  const parentLovePoints = [
    'Designed and crafted for toddlers, not just toddler-friendly.',
    'Gentle, safe, and intentionally never chaotic.',
    'Rotating diverse sensory-rich stations that keep little ones deeply engaged.',
    'Every visit brings something new to explore and discover.',
    'The first and only dedicated toddler sensory play space in West Hartford.',
    'Built and operated by a local mom who truly understands family rhythms.',
    'A cozy rhythm where parents can truly exhale.',
  ];

  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.heroGlowLeft} />
        <div className={styles.heroGlowRight} />

        <div style={{ position: 'relative', zIndex: 1 }}>
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
                  <span>Join Waitlist</span>
                  <span className={styles.primaryBtnSubtext}>(over 240+ local families already signed up)</span>
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

            <aside className={styles.parentsLoveAside}>
              <section className={styles.parentsLoveSection} aria-labelledby="parents-love-heading">
                <p className={styles.sectionEyebrow}>Why parents love Little Wanderers</p>
                <h2 id="parents-love-heading">Soft playtime for kids, softer days for families.</h2>
                <ul className={styles.parentsLoveList}>
                  {parentLovePoints.map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ul>
              </section>
            </aside>
          </div>
        </div>
      </section>
    </main>
  );
}
