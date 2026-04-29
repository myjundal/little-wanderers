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
          <p>
            A sensory play studio & cafe designed for little explorers and the grown-ups who love them.
          </p>
          <div className={styles.actions}>
            <PastelButton href="https://forms.gle/ucr5SGqiX6A6TJ8K7" external>
              Join waitlist
            </PastelButton>
          </div>
        </div>

        <div className={styles.right}>
          <PastelCard>
            <div className={styles.heroImageFrame}>
              <img
                src="/lobby.png"
                alt="Little Wanderers inspired interior"
              />
            </div>
          </PastelCard>
        </div>

        <span className={styles.starOne}>✦</span>
        <span className={styles.starTwo}>✦</span>
        <span className={styles.moon}>☾</span>
      </section>

      <div className={styles.cloudDivider} />

      <section className={styles.values}>
        <div>🌿 Sensory play for little explorers</div>
        <div>🤍 A gentle pause for parents</div>
        <div>☕ Cafe with good coffee</div>
        <div>✨ Connection & community</div>
      </section>
    </main>
  );
}
