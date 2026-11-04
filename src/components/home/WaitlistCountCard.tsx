import styles from '@/app/(public)/home.module.css';
import type { WaitlistDisplayCount } from '@/lib/waitlist-count';

export default function WaitlistCountCard({ initialCount: count, variant = 'default' }: { initialCount: WaitlistDisplayCount; variant?: 'default' | 'compact' }) {
  return (
    <aside
      className={`${styles.waitlistCountCard} ${variant === 'compact' ? styles.waitlistCountCardCompact : ''}`}
      aria-label={`${count.displayCount} plus local families have joined the Wanderlist`}
    >
      <div className={styles.waitlistNumberStage} aria-live="polite" aria-atomic="true">
        <strong key={count.displayCount} className={styles.waitlistNumber}>
          {count.displayCount}+
        </strong>
      </div>
      <div className={styles.waitlistCountCopy}>
        <span className={styles.waitlistCountEyebrow}>
          {variant === 'compact' ? 'Wanderlist families' : 'Families already joined the Wanderlist!'}
        </span>
      </div>
    </aside>
  );
}
