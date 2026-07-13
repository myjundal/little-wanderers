import styles from '@/app/(public)/home.module.css';
import WaitlistCountCard from '@/components/home/WaitlistCountCard';
import { PastelButton, PastelCard } from '@/components/pastel/PastelPrimitives';
import { PARTY_BOOKING_START_LABEL } from '@/lib/party-config';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getWaitlistCount } from '@/lib/waitlist-count';
import Image from 'next/image';

export default async function HomeComingSoon() {
  const supabase = createServerSupabaseClient();
  const [
    {
      data: { user },
    },
    waitlistCount,
  ] = await Promise.all([supabase.auth.getUser(), getWaitlistCount()]);
  const isAuthenticated = Boolean(user);

  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.left}>
          <h1>
            The only indoor
            <br />
            play <span className={`${styles.script} ${styles.heroScriptLine}`}>studio + cafe</span>
            <br />
            <span className={styles.heroLocationLine}>in West Hartford</span>
          </h1>
          <p className={styles.comingSoon}>Coming soon in mid September 2026</p>
          <p>
            Designed for curious 0-7 year olds, Little Wanderers blends sensory-friendly play, dreamy little
            discoveries, and a cozy cafe pause where grown-ups can actually sip good coffee while the kids wander.
          </p>
          <p>
            We&apos;re opening in Bishop&apos;s Corner plaza on the Target side, tucked between The Paper Store and Float
            Forty One, with Marshalls, Chopt, Koma, and more neighborhood favorites nearby.
          </p>
          <div className={styles.actions}>
            <div className={styles.waitlistAction}>
              <PastelButton href="https://forms.gle/ucr5SGqiX6A6TJ8K7" external>
                <span>Join waitlist</span>
                <small>Early access families hear first</small>
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
          <h2>Party holds are open for waitlist families</h2>
          <p>
            With our buildout and opening timeline in mind, party holds are available for dates starting {PARTY_BOOKING_START_LABEL}. Peek at available Friday, Saturday, and Sunday slots, then request a hold with no deposit today.
          </p>
          {!isAuthenticated && (
            <p className={styles.accessNote}>
              Requesting a party hold requires My Little Wanderers access. Early access accounts are currently available for waitlist families.
            </p>
          )}
        </div>
        <PastelButton href="/party">
          <span>View party calendar</span>
          <small>{isAuthenticated ? 'Request a hold from your account' : 'Sign in when you are ready to reserve'}</small>
        </PastelButton>
      </section>

      <div className={styles.softBand} />

      <section className={styles.values}>
        <div>🌿 Sensory play for little explorers</div>
        <div>🤍 A gentle pause for parents</div>
        <div>☕ Cafe with good coffee</div>
        <div>✨ Connection & community</div>
      </section>
    </main>
  );
}
