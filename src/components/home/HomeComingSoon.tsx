import styles from '@/app/(public)/home.module.css';
import { PastelButton, PastelCard } from '@/components/pastel/PastelPrimitives';

export default function HomeComingSoon() {
  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.left}>
          <h1>
            A calm space
            <br />
            to play, connect
            <br />
            and <span className={styles.script}>breathe</span>
          </h1>
          <p className={styles.comingSoon}>Coming soon in Summer 2026</p>
          <p>
            A calm, dreamy space designed and crafted for 0-7 year olds for sensory exploration, plus a break in the
            day and coffee-in-hand moments that feel restorative for parents too.
          </p>
          <p className={styles.subline}>Join waitlist for updates and early access!</p>
          <div className={styles.actions}>
            <PastelButton href="https://forms.gle/ucr5SGqiX6A6TJ8K7" external>
              <span>Join waitlist</span>
              <small>(Over 280+ local families already joined)</small>
            </PastelButton>
          </div>
        </div>

        <div className={styles.right}>
          <PastelCard>
            <div className={styles.heroImageFrame}>
              <img src="/lobby.png" alt="Little Wanderers lobby" />
            </div>
          </PastelCard>
        </div>

        <span className={styles.starOne}>✦</span>
        <span className={styles.starTwo}>✦</span>
        <span className={styles.moon}>☾</span>
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
