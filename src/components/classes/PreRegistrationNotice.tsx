import styles from './class-registration.module.css';

export default function PreRegistrationNotice() {
  return <aside className={styles.notice} aria-label="Registration options">
    <div className={styles.options}><div><strong>Express interest · free</strong><p>No payment today. No seat reserved.</p></div><div><strong>Pay now · reserve a seat</strong><p>Your seat is confirmed after payment is completed.</p></div></div>
    <p className={styles.noticeFoot}>Spaces are limited. Paid registration is currently available for Ms. Jamie’s art series.</p>
  </aside>;
}
