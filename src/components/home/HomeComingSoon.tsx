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
            and breathe
          </h1>
          <p>
            A sensory play studio & cafe designed for little explorers and the grown-ups who love them.
          </p>
          <div className={styles.actions}>
            <PastelButton href="https://forms.gle/ucr5SGqiX6A6TJ8K7" external>
              Join the Waitlist
            </PastelButton>
            <PastelButton href="/space" secondary>
              Explore the Space
            </PastelButton>
          </div>
        </div>

        <div className={styles.right}>
          <PastelCard>
            <div className={styles.heroImageFrame}>
              <img
                src="https://images.unsplash.com/photo-1618069734300-0de5f8686f6f?auto=format&fit=crop&w=1300&q=80"
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
        <div>Sensory play for little explorers</div>
        <div>A gentle pause for parents</div>
        <div>Cafe with good coffee</div>
        <div>Connection & community</div>
      </section>

      <section className={styles.about}>
        <h2>Thoughtfully designed for curious minds and busy hearts.</h2>
        <div>
          <p>
            Little Wanderers is a sensory studio & cafe created to support your child’s development through
            intentional play, while giving you space to relax, connect, and breathe.
          </p>
          <img src="/brand-mark.svg" alt="Little Wanderers fox mark" />
        </div>
      </section>
    </main>
  );
}
