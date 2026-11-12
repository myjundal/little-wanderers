import Link from 'next/link';
import SoftOpeningSignInButton from '@/components/soft-opening/SoftOpeningSignInButton';
import styles from './reservation-entry.module.css';

export const metadata = {
  title: 'Soft Opening Reservations',
  robots: { index: false, follow: false },
  description: 'Reserve a Little Wanderers visit. Soft opening starts November 11. Open play for ages 0–6, with flexible arrival windows.',
};

export default function Page() {
  return (
    <main className={styles.page}>
      <span className={styles.eyebrow}>Open play · Ages 0–6</span>
      <h1>Come wander.</h1>
      <p className={styles.intro}>Soft opening starts November 11.</p>

      <SoftOpeningSignInButton>Sign in &amp; reserve →</SoftOpeningSignInButton>
      <p className={styles.accountNote}>New here? Create your free account at sign-in.</p>

      <dl className={styles.facts}>
        <div><dt>Soft opening <span>Nov 11–15</span></dt><dd>9am–2pm</dd></div>
        <div><dt>Tentative Grand &amp; Regular opening</dt><dd>Nov 15</dd></div>
        <div><dt>Open play</dt><dd>$16 first child<br /><span>$10 each additional child</span></dd></div>
      </dl>
      <p className={styles.memberNote}>Founding members play free. <Link href="/pricing">View pricing</Link></p>

      <details className={styles.details}>
        <summary>A few visit details</summary>
        <ul>
          <li>November 14–16: 7 children per hourly arrival window. Other dates: 5 children per window. All times Eastern.</li>
          <li>Aim to arrive within your window; stay until you’re ready to leave, up to closing.</li>
          <li>Pay online or at the counter. Two accompanying adults included.</li>
          <li>Add any missing family names and child ages when reserving, then complete your waiver.</li>
          <li>Founding admission covers enrolled children; monthly billing starts on your first membership visit.</li>
        </ul>
        <p>We’re learning too, so service may be slower during soft opening. Thank you for your patience.</p>
      </details>
    </main>
  );
}
