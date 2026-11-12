import Link from 'next/link';
import PublicOpenPlayCalendar from '@/components/soft-opening/PublicOpenPlayCalendar';
import { loadPublicOpenPlaySlots } from '@/lib/public-open-play';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import styles from '@/components/soft-opening/public-open-play.module.css';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Reserve Open Play', description: 'Browse available Open Play arrival times before creating an account. Unlimited play until closing. Reservations recommended for ages 0–6 at Little Wanderers, West Hartford.' };
export default async function Page() {
  let slots: Awaited<ReturnType<typeof loadPublicOpenPlaySlots>> = [], unavailable = false;
  try { slots = await loadPublicOpenPlaySlots(createAdminSupabaseClient()); } catch { unavailable = true; }
  return <main className={styles.page}>
    <span className={styles.eyebrow}>Open play · Ages 0–6</span><h1>Come wander.<br />Stay a little longer.</h1>
    <p className={styles.intro}>Everyone welcome from Saturday, November 14. Explore the calendar and available arrival times below. Create a free account when you’re ready to reserve.</p>
    <PublicOpenPlayCalendar slots={slots} unavailable={unavailable} />
    <div className={styles.notes}><p><strong>Choose your arrival time</strong>Your reservation is an arrival window, so there’s no need to arrive right on the dot.</p><p><strong>Unlimited play, until closing</strong>Your arrival window is not a one-hour play limit. Settle in and play at your own pace.</p><p><strong>Reservations recommended</strong>Space is limited. Reserve ahead for your family; walk-ins are welcome when space allows.</p></div>
    <div className={styles.details}><section><h2>Our first chapter</h2><p>Soft opening, Nov 11–13: Wanderlist families only · 9am–3pm.<br />Open to everyone from Nov 14 · 9am–3pm.<br />From Monday, Nov 16 · 9am–6pm.</p><p>November 14–15: 7 children per arrival window. From Nov 16: 10 children per window. Hours may vary for private events. A signed waiver and accompanying caregiver are required.</p></section>
    <section><h2>A visit, your way.</h2><p>$16 first child · $10 each additional child age 7 months or older.<br /><strong>Babies 6 months and under: $10 when visiting alone; free with a sibling.</strong><br />Up to two accompanying adults included.</p><p>Admission is included for children covered by a membership. Pay online with Square or at the counter. <Link href="/pricing">Explore pricing &amp; memberships →</Link></p></section></div>
  </main>;
}
