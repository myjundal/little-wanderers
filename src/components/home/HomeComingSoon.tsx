import Image from 'next/image';
import Link from 'next/link';

import styles from '@/app/(public)/home.module.css';

const LOGO_SRC = '/logo.png';
const WAITLIST_URL = 'https://forms.gle/ucr5SGqiX6A6TJ8K7';

export default function HomeComingSoon() {
  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.heroGlowLeft} />
        <div className={styles.heroGlowRight} />

        <div className={styles.heroGrid}>
          <div className={styles.heroCopy}>
            <div className={styles.titleLockup}>
              <Image src={LOGO_SRC} alt="Little Wanderers logo" width={220} height={60} className={styles.titleLogo} priority />
            </div>

            <h1>
              A calm space
              <br />
              to play, connect
              <br />
              and breathe
            </h1>

            <p className={styles.subtitle}>
              A sensory play studio &amp; cafe designed for little explorers and the grown-ups who love them.
            </p>

            <div className={styles.ctaRow}>
              <Link href={WAITLIST_URL} className={styles.primaryBtn} target="_blank" rel="noreferrer">
                <span>Join the Waitlist</span>
              </Link>
              <Link href="/space" className={styles.secondaryBtn}>
                Explore the Space
              </Link>
            </div>

            <div className={styles.chips}>
              <span>✦ sensory play for little explorers</span>
              <span>♡ gentle pause for parents</span>
              <span>☕ cafe with good coffee</span>
            </div>
          </div>

          <aside className={styles.parentsLoveAside}>
            <section className={styles.parentsLoveSection}>
              <p className={styles.sectionEyebrow}>Play With Purpose</p>
              <h2>Calm, curated, and intentionally designed.</h2>
              <ul className={styles.parentsLoveList}>
                <li>Sensory exploration with safe and thoughtful materials.</li>
                <li>Open-ended play that encourages confidence and independence.</li>
                <li>Space for babies, toddlers, and families to settle in comfortably.</li>
              </ul>

              <div className={styles.photoGrid}>
                <div className={styles.photoMain}>
                  <img src="https://images.unsplash.com/photo-1618069734300-0de5f8686f6f?auto=format&fit=crop&w=900&q=80" alt="Calm indoor play studio" />
                </div>
                <div className={styles.photoStack}>
                  <div className={styles.photoSmall}>
                    <img src="https://images.unsplash.com/photo-1519710164239-da123dc03ef4?auto=format&fit=crop&w=600&q=80" alt="Minimal shelves and toys" />
                  </div>
                  <div className={styles.photoSmall}>
                    <img src="https://images.unsplash.com/photo-1505693314120-0d443867891c?auto=format&fit=crop&w=600&q=80" alt="Cozy seating nook" />
                  </div>
                </div>
              </div>
            </section>
          </aside>
        </div>
      </section>
    </main>
  );
}
