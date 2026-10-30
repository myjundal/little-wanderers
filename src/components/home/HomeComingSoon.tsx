import styles from '@/app/(public)/home.module.css';
import { CLASS_START_NOTE, CLASS_PRE_REGISTRATION_NOTE, classSizeLabel } from '@/lib/class-config';
import WaitlistCountCard from '@/components/home/WaitlistCountCard';
import { PastelButton, PastelCard } from '@/components/pastel/PastelPrimitives';
import { PARTY_BOOKING_START_LABEL } from '@/lib/party-config';
import {
  WEEKDAY_COLUMNS,
  buildGeneralWeeklySchedule,
  groupPublicClassSeries,
  timeOnlyLabel,
} from '@/lib/public-classes';
import { getPublicClasses } from '@/lib/public-class-data';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getWaitlistCount } from '@/lib/waitlist-count';
import Image from 'next/image';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://thelittlewanderers.com';
const ACCOUNT_URL = '/login?mode=new';

const localBusinessJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'LocalBusiness',
  name: 'Little Wanderers Play Studio & Cafe',
  alternateName: 'Little Wanderers West Hartford',
  url: siteUrl,
  logo: `${siteUrl}/logo.png`,
  image: `${siteUrl}/Lobby.png`,
  description:
    'Little Wanderers Play Studio & Cafe is an indoor play cafe for kids ages 0-5 and their grown-ups in Bishop’s Corner, West Hartford, CT.',
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

export default async function HomeComingSoon() {
  const supabase = await createServerSupabaseClient();
  const [
    {
      data: { user },
    },
    waitlistCount,
    classItems,
  ] = await Promise.all([supabase.auth.getUser(), getWaitlistCount(), getPublicClasses(80)]);
  const isAuthenticated = Boolean(user);
  const weeklyClassSchedule = buildGeneralWeeklySchedule(groupPublicClassSeries(classItems));
  const hasWeeklyClasses = WEEKDAY_COLUMNS.some((day) => (weeklyClassSchedule.get(day.value) ?? []).length > 0);

  return (
    <main className={styles.page}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(localBusinessJsonLd) }}
      />
      <section className={styles.hero}>
        <div className={styles.left}>
          <h1>
            The only indoor
            <br />
            play <span className={`${styles.script} ${styles.heroScriptLine}`}>studio + cafe</span>
            <br />
            <span className={styles.heroLocationLine}>in West Hartford</span>
          </h1>
          <p className={styles.comingSoon}>Opening Soon in November</p>
          <p>
            We&apos;re getting ready to open our indoor play studio and cafe for curious 0-5 year olds and their grown-ups
            in West Hartford, CT. For opening updates and priority reservation access,{' '}
            <a href={ACCOUNT_URL} className={styles.inlineLink}>
              join our Little Wanderers
            </a>{' '}
            and we&apos;ll share our opening date as soon as it&apos;s confirmed!
          </p>
          <p>
            We&apos;re opening in Bishop&apos;s Corner plaza on the Target side, tucked between The Paper Store and Float
            Forty One, with Marshalls, Chopt, Koma, and more West Hartford neighborhood favorites nearby.
          </p>
          <div className={styles.actions}>
            <div className={styles.waitlistAction}>
              <PastelButton href={isAuthenticated ? '/landing' : ACCOUNT_URL}>
                <span>Join/Login to My Little Wanderers</span>
                <small>Get opening updates and priority booking access from your account</small>
              </PastelButton>
              <WaitlistCountCard initialCount={{ displayCount: waitlistCount.displayCount }} />
            </div>
            <div className={styles.secondaryActions}>
              <PastelButton href="https://www.instagram.com/littlewanderers.weha" secondary external>
                <span>Follow on Instagram</span>
                <small>Follow along for buildout sneak peeks</small>
              </PastelButton>
              <PastelButton href="/visit-us" secondary>
                <span>Plan your visit</span>
                <small>Bishop&apos;s Corner, West Hartford, CT</small>
              </PastelButton>
            </div>
          </div>
        </div>

        <div className={styles.right}>
          <PastelCard>
            <div className={styles.heroImageFrame}>
              <Image src="/Lobby.png" alt="Little Wanderers lobby" width={900} height={700} priority sizes="(max-width: 980px) 100vw, 50vw" />
            </div>
          </PastelCard>
        </div>

        <span className={styles.starOne}>✦</span>
        <span className={styles.starTwo}>✦</span>
        <span className={styles.moon}>☾</span>
      </section>

      <section className={styles.partyFeature}>
        <div>
          <p className={styles.partyEyebrow}>Early access parties</p>
          <h2>Party holds are open for Wanderlist families</h2>
          <p>
            With our buildout and opening timeline in mind, party holds are available for dates starting {PARTY_BOOKING_START_LABEL}. Peek at available Friday afternoon, Saturday, and Sunday slots, then request a hold with no deposit today.
          </p>
          {!isAuthenticated && (
            <p className={styles.accessNote}>
              Requesting a party hold requires My Little Wanderers access. Sign up through October 28, 2026 to join the Wanderlist. From October 29, new accounts are regular website signups.
            </p>
          )}
        </div>
        <PastelButton href="/party">
          <span>View party calendar</span>
          <small>{isAuthenticated ? 'Request a hold from your account' : 'Sign in when you are ready to reserve'}</small>
        </PastelButton>
      </section>

      <section className={`${styles.partyFeature} ${styles.classFeature}`}>
        <div className={styles.classFeatureCopy}>
          <p className={styles.partyEyebrow}>Class pre-registration</p>
          <h2>Class pre-registration is open</h2>
          <p>{CLASS_START_NOTE}</p>
          <p>
            Browse our first small-group classes and pre-register with your My Little Wanderers account. New families can sign in by email, add a child&apos;s name and approximate age, then choose a class.
          </p>
          <p><strong>{CLASS_PRE_REGISTRATION_NOTE}</strong></p>
          {!isAuthenticated && (
            <p className={styles.accessNote}>
              Magic link sign-in will bring you back to class pre-registration.
            </p>
          )}
        </div>
        <div className={styles.classPreviewPanel} aria-label="Weekly class schedule preview">
          <div className={styles.classPreviewHeader}>
            <span>Weekly class map</span>
            <a href="/classes">View all</a>
          </div>
          <div className={styles.classWeekStrip}>
            {WEEKDAY_COLUMNS.map((day) => {
              const dayItems = weeklyClassSchedule.get(day.value) ?? [];
              return (
                <div className={styles.classWeekColumn} key={day.value}>
                  <div className={styles.classWeekDayLabel}>{day.label}</div>
                  <div className={styles.classWeekSlots}>
                    {dayItems.length === 0 ? (
                      <a className={`${styles.classWeekSlot} ${styles.classWeekSlotEmpty}`} href="/classes">
                        <span className={styles.classWeekTime}>{hasWeeklyClasses ? 'Open' : 'Soon'}</span>
                        <span className={styles.classWeekTitle}>{hasWeeklyClasses ? 'Open play' : 'Classes'}</span>
                      </a>
                    ) : (
                      dayItems.slice(0, 2).map((item) => (
                        <a
                          className={styles.classWeekSlot}
                          href={`/classes?class=${encodeURIComponent(item.id)}`}
                          key={`home-class-${item.id}`}
                        >
                          <span className={styles.classWeekTime}>{timeOnlyLabel(item.start_time)}</span>
                          <span className={styles.classWeekTitle}>{item.title}</span>
                          <span className={styles.classWeekMeta}>
                            {item.age_range ?? 'Ages TBA'} · {classSizeLabel(item.capacity)}
                          </span>
                        </a>
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div className={styles.classFeatureAction}>
          <PastelButton href="/classes">
            <span>View classes</span>
            <small>{isAuthenticated ? 'Choose a class from your account' : 'Sign in when you are ready to pre-register'}</small>
          </PastelButton>
        </div>
      </section>

      <div className={styles.softBand} />

      <section className={styles.values}>
        <div>🌿 Creative play for little explorers</div>
        <div>🤍 A gentle pause for parents</div>
        <div>☕ Cafe with good coffee</div>
        <div>✨ West Hartford community</div>
      </section>
    </main>
  );
}
