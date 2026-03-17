import Image from 'next/image';
import Link from 'next/link';

import styles from './home.module.css';

export const metadata = {
  title: 'Little Wanderers — Sensory-filled Learning Play Adventure',
  description: 'Play, learn, and wander in West Hartford.',
};

const LOGO_SRC = '/brand-mark.svg';

const featureBubbles = [
  {
    emoji: '🌙',
    title: 'Moonlight Sensory Corners',
    body: 'Glow blocks, tactile walls, and soft play islands that invite calm curiosity.',
  },
  {
    emoji: '🛸',
    title: 'Adventure Orbit Zones',
    body: 'Mini town play scenes and story prompts that help toddlers explore with confidence.',
  },
  {
    emoji: '☕',
    title: 'Parent Cloud Lounge',
    body: 'A comfy coffee nook with clear sightlines so caregivers can relax while little ones roam.',
  },
  {
    emoji: '🎂',
    title: 'Starlight Party Days',
    body: 'Birthday-ready packages, curated decor, and easy booking to make celebrations magical.',
  },
];

const showcaseItems = [
  {
    title: 'Tiny Explorer Class Passes',
    body: 'Drop into music, art, and movement classes designed around early-childhood rhythms.',
  },
  {
    title: 'Lavender Family Memberships',
    body: 'Flexible plans for frequent visits, priority booking, and smooth check-ins.',
  },
  {
    title: 'Weekend Galaxy Events',
    body: 'Story nights, sensory themes, and seasonal mini festivals to keep visits fresh.',
  },
];

export default function HomePage() {
  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.stars}>
          <span className={styles.starA}>⭐</span>
          <span className={styles.starB}>✨</span>
          <span className={styles.starC}>🪐</span>
          <div className={styles.cloud} />
        </div>

        <div className={styles.heroGrid}>
          <div>
            <span className={styles.badge}>💜 WEST HARTFORD · SPACE LAVENDER KIDS CAFE</span>
            <h1 className={styles.title}>
              Tiny Steps,
              <br />
              Cosmic Wonder
            </h1>
            <p className={styles.subtitle}>
              A playful indoor kids café where babies and toddlers can safely wander, imagine, and learn through
              sensory-rich activities in a dreamy purple universe.
            </p>

            <div className={styles.ctaRow}>
              <Link href="/login" className={styles.primaryBtn}>
                Start Membership
              </Link>
              <Link href="/pricing" className={styles.secondaryBtn}>
                View Pricing
              </Link>
              <Link href="/faq" className={styles.secondaryBtn}>
                Read FAQ
              </Link>
            </div>
          </div>

          <div className={styles.heroCard}>
            <Image
              src={LOGO_SRC}
              alt="Little Wanderers brand fox"
              width={620}
              height={620}
              priority
              className={styles.heroImage}
            />
            <div className={styles.orbitTag}>✨ Soft Play · Creative Play · Calm Play</div>
          </div>
        </div>
      </section>

      <section className={styles.featureGrid}>
        {featureBubbles.map((item) => (
          <article key={item.title} className={styles.featureCard}>
            <div className={styles.featureIcon}>{item.emoji}</div>
            <h3 className={styles.featureTitle}>{item.title}</h3>
            <p className={styles.featureBody}>{item.body}</p>
          </article>
        ))}
      </section>

      <section className={styles.showcase}>
        {showcaseItems.map((item) => (
          <article key={item.title} className={styles.showcaseCard}>
            <h3 className={styles.showcaseTitle}>{item.title}</h3>
            <p className={styles.showcaseCopy}>{item.body}</p>
          </article>
        ))}
      </section>

      <section className={styles.ctaBanner}>
        <div>
          <h3 className={styles.ctaTitle}>🚀 Ready for your family&apos;s next lavender-space adventure?</h3>
          <p className={styles.ctaText}>
            Create an account to manage memberships, classes, and party bookings in one easy dashboard.
          </p>
        </div>
        <Link href="/login" className={styles.secondaryBtn}>
          Go to Login →
        </Link>
      </section>
    </main>
  );
}
