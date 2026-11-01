import Link from 'next/link';
import { getCurrentUserRole } from '@/lib/authz';
import styles from '@/components/staff/StaffPortal.module.css';
import StaffToolNav from '@/components/staff/StaffToolNav';
export default async function StaffHomePage() {
  const { role, roles, isKiosk } = await getCurrentUserRole();
  return <main className={styles.main}><h1>Staff Dashboard</h1>{isKiosk && <p>Your shift started when you entered your PIN. Use “Log out & clock out” when you finish.</p>}<section className={styles.card}><StaffToolNav /></section><section className={styles.card}><h2>My shift</h2><Link href="/employee">{isKiosk ? 'My Timecards' : 'My PIN & Timecards'}</Link></section>{(role === 'owner' || role === 'admin') && <section className={styles.card}><h2>Administration</h2><div className={styles.links}><Link href="/staff/team">Staff & Timecards</Link><Link href="/staff/campaigns">Email campaigns</Link><Link href="/staff/occupancy">Occupancy management</Link></div></section>}{roles.includes('instructor')&&<section className={styles.card}><h2>Teaching</h2><Link href="/teaching">Teaching Classes</Link></section>}{!isKiosk&&<section className={styles.card}><h2>My family bookings</h2><div className={styles.links}><Link href="/landing/classschedule">My Classes</Link><Link href="/landing/party">My Parties</Link></div></section>}</main>;
}
