import Link from 'next/link';
import SoftOpeningSignInButton from '@/components/soft-opening/SoftOpeningSignInButton';
import styles from '../soft-opening/reservation-entry.module.css';

export const metadata = {
  title: 'Reserve Open Play',
  description: 'All families welcome from Saturday, November 14. Reserve Open Play at Little Wanderers in West Hartford, CT for ages 0–6.',
};

export default function Page() {
  return <main className={styles.page}>
    <span className={styles.eyebrow}>Open play · Ages 0–6</span>
    <h1>Come wander.</h1>
    <p className={styles.intro}>Everyone welcome from Saturday, November 14.</p>
    <SoftOpeningSignInButton destination="/landing/open-play">Reserve Open Play →</SoftOpeningSignInButton>
    <p className={styles.accountNote}>Sign in or create your free account. No invitation or membership needed.</p>
    <dl className={styles.facts}>
      <div><dt>Soft opening <span>Nov 14–15</span></dt><dd>9am–2pm</dd></div>
      <div><dt>Regular hours <span>From Nov 16</span></dt><dd>9am–5pm</dd></div>
      <div><dt>Open play</dt><dd>$16 first child<br /><span>$10 each additional child</span></dd></div>
    </dl>
    <p className={styles.memberNote}>Founding admission is included for enrolled children. <Link href="/pricing">View pricing</Link></p>
    <details className={styles.details}>
      <summary>A few visit details</summary>
      <ul>
        <li>November 14–15: 7 children per hourly arrival window. From Monday, November 16: 10 children per window. All times Eastern.</li>
        <li>Arrive within your window and stay until you’re ready to leave, up to closing.</li>
        <li>Pay online or at the counter. Up to two accompanying adults included.</li>
        <li>Include every child attending. Siblings 6 months and under have no additional admission charge.</li>
        <li>Complete your family waiver before entry. Children must stay with their caregiver.</li>
      </ul>
      <p>We’re finding our rhythm during soft opening. Thank you for your patience.</p>
    </details>
  </main>;
}
