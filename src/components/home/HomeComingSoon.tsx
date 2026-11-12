import styles from '@/app/(public)/home.module.css';
import { CLASS_START_NOTE, CLASS_PRE_REGISTRATION_NOTE, classSizeLabel } from '@/lib/class-config';
import { PastelButton, PastelCard } from '@/components/pastel/PastelPrimitives';
import {
  WEEKDAY_COLUMNS,
  buildGeneralWeeklySchedule,
  groupPublicClassSeries,
  timeOnlyLabel,
} from '@/lib/public-classes';
import { getPublicClasses } from '@/lib/public-class-data';
import Image from 'next/image';
import Link from 'next/link';
import { Suspense } from 'react';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://thelittlewanderers.com';

const localBusinessJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'LocalBusiness',
  name: 'Little Wanderers Play Studio & Cafe',
  alternateName: 'Little Wanderers West Hartford',
  url: siteUrl,
  logo: `${siteUrl}/logo.png`,
  image: `${siteUrl}/play-studio.jpg`,
  description:
    'Little Wanderers Play Studio & Cafe is an indoor play cafe for kids ages 0–6 and their grown-ups in Bishop’s Corner, West Hartford, CT.',
  address: {
    '@type': 'PostalAddress',
    addressLocality: 'West Hartford',
    addressRegion: 'CT',
    addressCountry: 'US',
  },
  areaServed: [
    {
      '@type': 'City',
      name: 'West Hartford',
    },
    {
      '@type': 'State',
      name: 'Connecticut',
    },
  ],
  sameAs: [
    'https://www.instagram.com/littlewanderers.weha',
    'https://facebook.com/littlewanderers.weha',
  ],
};

async function WeeklyClassPreview() {
  const classItems = await getPublicClasses(80);
  const weeklyClassSchedule = buildGeneralWeeklySchedule(groupPublicClassSeries(classItems));
  const hasWeeklyClasses = WEEKDAY_COLUMNS.some((day) => (weeklyClassSchedule.get(day.value) ?? []).length > 0);
  return (
    <div className={styles.classWeekStrip}>
      {WEEKDAY_COLUMNS.map((day) => {
        const dayItems = weeklyClassSchedule.get(day.value) ?? [];
        return (
          <div className={styles.classWeekColumn} key={day.value}>
            <div className={styles.classWeekDayLabel}>{day.label}</div>
            <div className={styles.classWeekSlots}>
              {dayItems.length === 0 ? (
                <Link className={`${styles.classWeekSlot} ${styles.classWeekSlotEmpty}`} href="/classes">
                  <span className={styles.classWeekTime}>{hasWeeklyClasses ? 'Open' : 'Soon'}</span>
                  <span className={styles.classWeekTitle}>{hasWeeklyClasses ? 'Open play' : 'Classes'}</span>
                </Link>
              ) : dayItems.slice(0, 2).map((item) => (
                <Link className={styles.classWeekSlot} href={`/classes?class=${encodeURIComponent(item.id)}`} key={item.id}>
                  <span className={styles.classWeekTime}>{timeOnlyLabel(item.start_time)}</span>
                  <span className={styles.classWeekTitle}>{item.title}</span>
                  <span className={styles.classWeekMeta}>{item.age_range ?? 'Ages TBA'} · {classSizeLabel(item.capacity)}</span>
                </Link>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default async function HomeComingSoon() {
  return (
    <main className={styles.page}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(localBusinessJsonLd) }}
      />
      <section className={styles.hero}>
        <div className={styles.left}>
          <p className={styles.eyebrow}>West Hartford · Play studio &amp; cafe · Ages 0–6</p>
          <h1>A little play.<br /><span>A little pause.</span></h1>
          <p className={styles.openingBadge}>Everyone welcome from Saturday, November 14</p>
          <p>A thoughtful indoor play space for curious little ones, and a cozy cafe for their grown-ups. We’re ready for our first little adventures together.</p>
          <div className={styles.heroActions}><PastelButton href="/open-play">Reserve Open Play →</PastelButton><Link href="/classes">Explore classes</Link></div>
          <p className={styles.heroFootnote}>Bishop’s Corner, West Hartford · Grand opening coming soon</p>
        </div>
        <div className={styles.right}><PastelCard><div className={styles.heroImageFrame}><Image src="/play-studio.jpg" alt="Little Wanderers play studio with a purple foam pit, climbing structure, and slide" width={1280} height={749} priority sizes="(max-width: 980px) calc(100vw - 72px), (max-width: 1400px) 50vw, 700px" /></div></PastelCard><p className={styles.photoCaption}>Room to explore. Space to take a breath.</p></div>
      </section>
      <section className={styles.openingNote} aria-label="Soft opening details"><div><span className={styles.eyebrow}>Our first chapter</span><h2>A warm welcome, with a little extra grace.</h2><p>During soft opening, service may be a little slower as our team learns and finds its rhythm. Thank you for your patience and encouragement. Our grand opening date is coming soon.</p></div><div className={styles.quickFacts}><p><strong>Soft opening · Nov 11–15</strong><span>9am–2pm</span></p><p><strong>Regular opening · From Nov 16</strong><span>9am–5pm</span></p><p><strong>5 children</strong><span>per arrival window · soft opening only</span></p></div></section>
      <section className={styles.explore} aria-label="Ways to wander"><Link href="/open-play"><span className={styles.eyebrow}>Drop in, settle in</span><h2>Open play</h2><p>$16 for your first child.<br />$10 for each additional child.</p><strong>Reserve your visit →</strong></Link><Link href="/pricing#memberships"><span className={styles.eyebrow}>Make it your little ritual</span><h2>Founding membership</h2><p>$50/month for your first child.<br />+$20/month per eligible sibling.</p><strong>Explore lifetime rates →</strong></Link><Link href="/gift-cards"><span className={styles.eyebrow}>Give a little wonder</span><h2>Gift cards</h2><p>A thoughtful gift for a little explorer<br />and their favorite grown-up.</p><strong>Find a gift card →</strong></Link></section>

      <section className={`${styles.partyFeature} ${styles.classFeature}`}>
        <div className={styles.classFeatureCopy}>
          <p className={styles.partyEyebrow}>Class registration</p>
          <h2>Find your next class</h2>
          <p>{CLASS_START_NOTE}</p>
          <p>
            Choose your class dates, sign in, and pay securely to confirm your child’s place. All families are welcome.
          </p>
          <p><strong>{CLASS_PRE_REGISTRATION_NOTE}</strong></p>
          <p className={styles.accessNote}>Sign-in brings you back to choose dates and complete registration.</p>
        </div>
        <div className={styles.classPreviewPanel} aria-label="Weekly class schedule preview">
          <div className={styles.classPreviewHeader}>
            <span>Weekly class map</span>
            <Link href="/classes">View all</Link>
          </div>
          <Suspense fallback={<div role="status" style={{ minHeight: 200 }}>Loading the weekly schedule…</div>}>
            <WeeklyClassPreview />
          </Suspense>
        </div>
        <div className={styles.classFeatureAction}>
          <PastelButton href="/classes">
            <span>View classes</span>
            <small>Choose dates and reserve your place</small>
          </PastelButton>
        </div>
      </section>

      <section className={styles.partyFeature}><div><p className={styles.partyEyebrow}>Celebrate with us</p><h2>A little party. A big memory.</h2><p>Explore our party spaces, packages, and available dates for your next celebration.</p></div><PastelButton href="/party" secondary>Explore birthday parties →</PastelButton></section>
      <footer className={styles.homeFooter}><p>Find us in Bishop’s Corner, on the Target side between The Paper Store and Float Forty One.</p><div><Link href="/visit-us">Directions &amp; parking</Link><Link href="/cafe">Our cafe</Link><a href="https://www.instagram.com/littlewanderers.weha" target="_blank" rel="noreferrer">Instagram</a><Link href="/contact">Say hello</Link></div></footer>
    </main>
  );
}
