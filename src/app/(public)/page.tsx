import Image from 'next/image';
import Link from 'next/link';

import styles from './home.module.css';

export const metadata = {
  title: 'Little Wanderers — Sensory-filled Learning Play Adventure',
  description: 'Play, learn, and wander in West Hartford.',
};

const LOGO_SRC = '/brand-mark.svg';

const playZones = [
  {
    title: 'Sensory Forest Corner',
    body: 'Soft textures, balancing toys, and calming lights for tiny explorers who learn through touch.',
  },
  {
    title: 'Pretend Town Studio',
    body: 'Mini markets, kitchen sets, and story props designed for playful role-switching and social growth.',
  },
  {
    title: 'Baby Nest Area',
    body: 'A gentle, padded nook for crawlers and early walkers with age-appropriate discovery toys.',
  },
];

const cafeMoments = [
  {
    title: 'Open Play Sessions',
    body: 'Flexible daily spots that fit naps, meals, and real family rhythms.',
  },
  {
    title: 'Creative Class Days',
    body: 'Music, movement, and art crafted for short attention spans and joyful repetition.',
  },
  {
    title: 'Birthday Celebrations',
    body: 'Warm, curated party setups with room styling and seamless online scheduling.',
  },
];

export default function HomePage() {
  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.heroGlowLeft} />
        <div className={styles.heroGlowRight} />

        <div className={styles.heroGrid}>
          <div className={styles.heroCopy}>
            <p className={styles.kicker}>Little Wanderers Kids Café · West Hartford</p>
            <h1>Where little days feel magical, cozy, and full of wonder.</h1>
            <p className={styles.subtitle}>
              A boutique kids café in soft lavender space tones, made for babies and toddlers to play safely while
              families enjoy a calm, beautiful environment.
            </p>

            <div className={styles.ctaRow}>
              <Link href="/login" className={styles.primaryBtn}>
                Start Membership
              </Link>
              <Link href="/pricing" className={styles.secondaryBtn}>
                View Pricing
              </Link>
              <Link href="/faq" className={styles.linkBtn}>
                Plan Your Visit
              </Link>
            </div>

            <div className={styles.chips}>
              <span>Soft play focused</span>
              <span>Ages 0–5</span>
              <span>Parent-friendly lounge</span>
            </div>
          </div>

          <aside className={styles.heroVisual}>
            <div className={styles.imageWrap}>
              <Image
                src={LOGO_SRC}
                alt="Little Wanderers brand fox"
                width={620}
                height={620}
                priority
                className={styles.heroImage}
              />
            </div>
            <p className={styles.visualNote}>A gentle space for sensory play, imagination, and family moments.</p>
          </aside>
        </div>
      </section>

      <section className={styles.zonesSection}>
        <header className={styles.sectionHeader}>
          <p>Play spaces designed with early childhood specialists in mind</p>
          <h2>Every corner feels like a tiny world.</h2>
        </header>

        <div className={styles.cardGrid}>
          {playZones.map((zone) => (
            <article key={zone.title} className={styles.zoneCard}>
              <h3>{zone.title}</h3>
              <p>{zone.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.momentsSection}>
        <header className={styles.sectionHeader}>
          <p>Built for everyday visits and milestone memories</p>
          <h2>A true kids café experience, not just a playroom.</h2>
        </header>

        <div className={styles.cardGrid}>
          {cafeMoments.map((item) => (
            <article key={item.title} className={styles.momentCard}>
              <h3>{item.title}</h3>
              <p>{item.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.ctaBanner}>
        <div>
          <h3>Ready for your family&apos;s first visit?</h3>
          <p>Manage open play, classes, and party bookings in one easy dashboard.</p>
        </div>
        <Link href="/login" className={styles.secondaryBtn}>
          Go to Login
        </Link>
      </section>
    </main>
  );
}
