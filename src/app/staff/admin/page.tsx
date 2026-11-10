import Link from 'next/link';
import { getCurrentUserRole } from '@/lib/authz';
import StaffToolNav from '@/components/staff/StaffToolNav';
import styles from '@/components/staff/StaffPortal.module.css';

export default async function AdministrationPage() {
  const { role, roles, isKiosk } = await getCurrentUserRole();
  const isOwner = role === 'owner' || role === 'admin';
  return <main className={styles.main}>
    <StaffToolNav active="admin" />
    <h1>Timecard &amp; admin</h1>
    <section className={styles.card}><h2>My shift</h2><div className={styles.links}>
      <Link href="/employee">{isKiosk ? 'My Timecards' : 'My PIN & Timecards'}</Link>
      {roles.includes('instructor') && <Link href="/teaching">Teaching Classes</Link>}
    </div></section>
    {isOwner && <section className={styles.card}><h2>Administration</h2><div className={styles.links}>
      <Link href="/staff/team">Staff &amp; Timecards</Link>
      <Link href="/staff/campaigns">Email campaigns</Link>
      <Link href="/staff/founding-memberships">Membership management</Link>
    </div></section>}
  </main>;
}
