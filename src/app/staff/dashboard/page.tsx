import Link from 'next/link';
import { getCurrentUserRole } from '@/lib/authz';
import styles from '@/components/staff/StaffPortal.module.css';
export default async function StaffHomePage() {
  const { roles, isKiosk } = await getCurrentUserRole();
  return <main className={styles.main}><h1>Staff Dashboard</h1>{isKiosk && <p>Your shift started when you entered your PIN. Use “Log out & clock out” when you finish.</p>}<section className={styles.card}><div className={styles.links}><Link href="/">Main Homepage</Link><Link href="/staff">Staff Tool</Link><Link href="/staff/checkin">Staff QR check-in</Link><Link href="/staff/families">Family management</Link><Link href="/staff/classes">Class pre-registrations</Link><Link href="/staff/occupancy">Occupancy management</Link><Link href="/employee">{isKiosk?'My Timecards':'My PIN & Timecards'}</Link></div></section>{roles.includes('instructor')&&<section className={styles.card}><h2>Teaching</h2><Link href="/teaching">Teaching Classes</Link></section>}{!isKiosk&&<section className={styles.card}><h2>My family bookings</h2><div className={styles.links}><Link href="/landing/classschedule">My Classes</Link><Link href="/landing/party">My Parties</Link></div></section>}</main>;
}
