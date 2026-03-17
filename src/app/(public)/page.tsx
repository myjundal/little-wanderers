import Image from 'next/image';
import Link from 'next/link';

import styles from './home.module.css';

export const metadata = {
  title: 'Little Wanderers — Sensory-filled Learning Play Adventure',
  description: 'Play, learn, and wander in West Hartford.',
};

const LOGO_SRC = '/brand-mark.svg';

const highlights = [
  {
    label: '01',
    title: 'Sensory Play Garden',
    body: 'Soft textures, gentle lights, and toddler-safe play structures designed for calm exploration.',
  },
  {
    label: '02',
    title: 'Imagination Studio',
    body: 'Role play scenes and rotating activity stations that turn each visit into a tiny adventure.',
  },
  {
    label: '03',
    title: 'Cozy Parent Lounge',
    body: 'A warm café corner with comfortable seating and full visibility into every play zone.',
  },
  {
    label: '04',
    title: 'Boutique Party Room',
    body: 'Curated birthday setups with guided flow, custom themes, and easy online booking.',
  },
];

const offerings = [
  {
    title: 'Daily Open Play',
    body: 'Flexible admission slots for babies and toddlers who thrive with free, sensory-led movement.',
  },
  {
    title: 'Creative Classes',
    body: 'Music, art, and movement sessions crafted for early childhood attention spans and routines.',
  },
  {
    title: 'Membership Plans',
    body: 'Consistent weekly fun, faster check-in, and preferred access for your family schedule.',
  },
];

export default function HomePage() {
  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.glowTop} />
        <div className={styles.glowBottom} />

        <div className={styles.heroGrid}>
          <div className={styles.heroContent}>
            <span className={styles.badge}>West Hartford · Lavender Space Kids Café</span>
            <h1 className={styles.title}>A softer, sweeter space for little wanderers.</h1>
            <p className={styles.subtitle}>
              Little Wanderers is a dreamy indoor kids café where tiny explorers can play, create, and grow in a
              cozy lavender universe made for early childhood.
            </p>

            <div className={styles.ctaRow}>
              <Link href="/login" className={styles.primaryBtn}>
                Join Membership
              </Link>
              <Link href="/pricing" className={styles.secondaryBtn}>
                See Pricing
              </Link>
              <Link href="/faq" className={styles.ghostBtn}>
                Visitor Guide
              </Link>
            </div>

            <div className={styles.heroStats}>
              <article>
                <strong>Toddler-first</strong>
                <p>Designed for babies to age 5</p>
              </article>
              <article>
                <strong>Comfort-focused</strong>
                <p>Calm acoustics and padded zones</p>
              </article>
              <article>
                <strong>Family-ready</strong>
                <p>Classes, parties, and memberships</p>
              </article>
            </div>
          </div>

          <aside className={styles.visualCard}>
            <div className={styles.windowFrame}>
              <Image
                src={LOGO_SRC}
                alt="Little Wanderers brand fox"
                width={620}
                height={620}
                priority
                className={styles.heroImage}
              />
            </div>
            <p className={styles.visualCaption}>Soft Play · Sensory Play · Story Play</p>
          </aside>
        </div>
      </section>

      <section className={styles.highlights}>
        {highlights.map((item) => (
          <article key={item.title} className={styles.highlightCard}>
            <span className={styles.highlightLabel}>{item.label}</span>
            <h3>{item.title}</h3>
            <p>{item.body}</p>
          </article>
        ))}
      </section>

      <section className={styles.offerings}>
        <header>
          <p className={styles.sectionEyebrow}>What families love most</p>
          <h2>Built like a boutique kids café, not just a playroom.</h2>
        </header>
        <div className={styles.offeringsGrid}>
          {offerings.map((item) => (
            <article key={item.title} className={styles.offeringCard}>
              <h3>{item.title}</h3>
              <p>{item.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.ctaBanner}>
        <div>
          <h3>Plan your next visit in one place.</h3>
          <p>Create an account to manage open play, classes, memberships, and party bookings.</p>
        </div>
        <Link href="/login" className={styles.secondaryBtn}>
          Go to Login
        </Link>
      </section>
    </main>
  );
}
