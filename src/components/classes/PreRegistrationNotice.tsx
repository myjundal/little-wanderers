import styles from './class-registration.module.css';

export default function PreRegistrationNotice() {
  return <aside className={styles.notice} aria-label="Registration options">
    <div className={styles.options}><div><strong>Pay at counter</strong><p>Pay before class, subject to availability. Your seat is confirmed after payment.</p></div><div><strong>Pay now to confirm your seat</strong><p>Your seat is confirmed after payment is completed.</p></div></div>
    <p className={styles.noticeFoot}>Spaces are limited. Paid registration is open to all families. Choose multiple class dates and pay once. Ms. Jamie’s art series is registered separately.</p>
  </aside>;
}
