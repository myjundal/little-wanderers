import Link from 'next/link';
import LiveOpenPlayCalendar from '@/components/soft-opening/LiveOpenPlayCalendar';
import styles from '@/components/soft-opening/public-open-play.module.css';
export const metadata = { title: 'Reserve Open Play', description: 'Browse available Open Play arrival times before creating an account. Unlimited play until closing. Reservations recommended for ages 0–6 at Little Wanderers, West Hartford.' };
export default function Page() {
  return <main className={styles.page}>
    <span className={styles.eyebrow}>Open play · Ages 0–6</span><h1>Come wander.<br />Stay a little longer.</h1>
    <p className={styles.intro}>We’re fully open! Explore the calendar and available arrival times below. Create a free account when you’re ready to reserve.</p>
    <div className={styles.notice}><strong>Your reservation is an ARRIVAL WINDOW.</strong><p>Arrive any time during your reserved hour, then stay and play until closing. It is not a one-hour play session.</p><strong>Weekend reservations are highly recommended.</strong></div>
    <LiveOpenPlayCalendar />
    <div className={styles.notes}><p><strong>ARRIVAL WINDOW</strong>Arrive any time during your reserved window. The usual last arrival window is 4–5 PM. Check the selected date for private-event hours.</p><p><strong>UNLIMITED STAY until closing</strong>Your arrival window is not a one-hour play limit. Settle in and play at your own pace.</p><p><strong>Weekends: highly recommended</strong>Space is limited. Reserve ahead for your family; walk-ins are welcome when space allows.</p></div>
    <div className={styles.details}><section><h2>Plan your visit</h2><p>Open daily · 9am–6pm Eastern.</p><p>6 children per hourly arrival window. Hours may vary for private events. A signed waiver and accompanying caregiver are required.</p></section>
    <section><h2>A visit, your way.</h2><p>Under 6 months: free · 6–11 months: $10.<br /><strong>12 months and older: $16 first child · $10 each additional child age 6 months or older.</strong><br />Up to two accompanying adults included.</p><p>Admission is included for children covered by a membership. Pay online with Square or at the counter. <Link href="/pricing">Explore pricing &amp; memberships →</Link></p></section></div>
  </main>;
}
