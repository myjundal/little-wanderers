import Image from 'next/image';
import Link from 'next/link';

import styles from './home.module.css';

export const metadata = {
  title: 'Little Wanderers — Sensory-filled Learning Play Adventure',
  description: 'Play, learn, and wander in West Hartford.',
};

const LOGO_SRC = '/brand-mark.svg';

const spaceCards = [
  {
    title: 'For little ones',
    body: 'Soft textures, role play, gentle movement, and sensory moments that feel exploratory without becoming overwhelming.',
  },
  {
    title: 'For parents',
    body: 'A slower café rhythm with comfortable seating, warm light, and a design language that feels curated rather than chaotic.',
  },
];

const classCards = [
  {
    icon: '✦',
    title: 'Curated play spaces',
    body: 'Every zone is designed to feel edited, pastel-soft, and easy to settle into within a few seconds.',
  },
  {
    icon: '☾',
    title: 'Calm class moments',
    body: 'Music, movement, and creative sessions are presented with a more boutique tone than a typical play venue.',
  },
  {
    icon: '♡',
    title: 'Parent-friendly visits',
    body: 'The atmosphere is made for coffee, conversation, and the kind of outing you actually want to repeat.',
  },
];

const visitMoments = [
  'Open play sessions in a softer, more intentional environment.',
  'Class highlights and sensory-led programming for little wanderers.',
  'A beautiful, easy outing that still feels practical for real family routines.',
];

export default function HomePage() {
  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.heroGlowLeft} />
        <div className={styles.heroGlowRight} />

        <div className={styles.heroGrid}>
          <div className={styles.heroCopy}>
            <p className={styles.kicker}>☾ West Hartford Sensory Play Café</p>
            <h1>A softer kind of play for little wanderers.</h1>
            <p className={styles.subtitle}>
              A calm, boutique space for sensory exploration, slower mornings, and coffee-in-hand moments that feel
              restorative for parents too.
            </p>
            <p className={styles.subline}>Made to feel like a deep breath — not a loud indoor playground.</p>

            <div className={styles.ctaRow}>
              <Link href="#waitlist" className={styles.primaryBtn}>
                Join Waitlist
              </Link>
              <Link href="#space" className={styles.secondaryBtn}>
                Explore Space
              </Link>
            </div>

            <div className={styles.chips}>
              <span>✦ sensory-led</span>
              <span>☾ calm</span>
              <span>♡ connection</span>
            </div>
          </div>

          <aside className={styles.heroVisual}>
            <div className={styles.heroVisualTop}>
              <span className={styles.visualEyebrow}>Today at Little Wanderers</span>
              <span className={styles.starA}>✦</span>
              <span className={styles.starB}>✦</span>
              <span className={styles.moon}>☾</span>
            </div>

            <div className={styles.visualCard}>
              <Image src={LOGO_SRC} alt="Little Wanderers brand mark" width={110} height={110} className={styles.heroLogo} priority />
              <h2>Soft play, beautifully slowed down.</h2>
              <p>
                Open play, class moments, and a lounge-like atmosphere designed for babies, toddlers, and the grownups
                who come with them.
              </p>
            </div>

            <div className={styles.visualBadge}>
              <strong>Boutique atmosphere</strong>
              <span>For babies, toddlers, and coffee-holding grownups.</span>
            </div>
          </aside>
        </div>
      </section>

      <div className={styles.waveWrap} aria-hidden="true">
        <svg viewBox="0 0 1440 160" className={styles.wave} preserveAspectRatio="none">
          <path d="M0 66C115 106 247 120 397 98C528 79 607 18 748 18C931 18 1036 116 1204 112C1301 110 1386 86 1440 66V160H0V66Z" fill="#F6F1FF" />
        </svg>
      </div>

      <section id="space" className={styles.storySection}>
        <div className={styles.storyCopy}>
          <p className={styles.sectionEyebrow}>A place that holds both wonder and ease</p>
          <h2>Designed for early curiosity, but styled for the parent who wants the outing to feel beautiful too.</h2>
          <p>
            Little Wanderers is imagined as a calm sensory play café where children can explore safely while parents
            enjoy a more elevated, restorative environment.
          </p>

          <div className={styles.tags}>
            <span>✦ sensory</span>
            <span>☾ calm</span>
            <span>♡ connection</span>
          </div>
        </div>

        <div className={styles.storyCards}>
          {spaceCards.map((card) => (
            <article key={card.title} className={styles.softCard}>
              <p className={styles.cardEyebrow}>{card.title}</p>
              <h3>{card.title === 'For little ones' ? 'Soft discovery' : 'A calmer outing'}</h3>
              <p>{card.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="classes" className={styles.featuresSection}>
        <div className={styles.sectionHeadingCenter}>
          <p className={styles.sectionEyebrow}>Why it feels different</p>
          <h2>Premium, warm, and intentionally understated.</h2>
        </div>

        <div className={styles.featureGrid}>
          {classCards.map((card) => (
            <article key={card.title} className={styles.featureCard}>
              <span className={styles.featureIcon}>{card.icon}</span>
              <h3>{card.title}</h3>
              <p>{card.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="visit" className={styles.visitSection}>
        <div className={styles.visitCopy}>
          <p className={styles.sectionEyebrow}>Visit</p>
          <h2>I want to sit here with my coffee while my child plays.</h2>
          <p>
            That is the feeling this homepage now prioritizes: calm within seconds, premium without feeling cold, and
            genuinely welcoming for modern family routines.
          </p>
        </div>

        <div className={styles.visitList}>
          {visitMoments.map((item) => (
            <article key={item} className={styles.visitItem}>
              <span>✦</span>
              <p>{item}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="waitlist" className={styles.waitlistSection}>
        <div>
          <p className={styles.sectionEyebrow}>Join Waitlist</p>
          <h2>Be first to hear about openings, class releases, and soft-launch updates.</h2>
          <p>
            Until a dedicated waitlist flow is built, this CTA routes families into the current login path so the
            experience stays connected to the existing app structure.
          </p>
        </div>

        <div className={styles.waitlistActions}>
          <Link href="/login" className={styles.primaryBtn}>
            Join Waitlist
          </Link>
          <Link href="/pricing" className={styles.ghostBtn}>
            View Pricing
          </Link>
        </div>
      </section>
    </main>
  );
}
