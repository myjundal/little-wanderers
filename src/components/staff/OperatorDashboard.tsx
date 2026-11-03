import Link from 'next/link';
import StaffToolNav from './StaffToolNav';
import styles from './StaffPortal.module.css';

export default function OperatorDashboard({ role, roles, isKiosk, displayName }: {
  role: string | null;
  roles: string[];
  isKiosk: boolean;
  displayName?: string | null;
}) {
  const isOwner = role === 'owner' || role === 'admin';
  return <main className={styles.main}>
    <h1>{isOwner ? 'Owner Dashboard' : 'Staff Dashboard'}</h1>
    {displayName && <p>Hello, {displayName}</p>}
    {isKiosk && <p>Your shift started when you entered your PIN. Use “Log out & clock out” when you finish.</p>}
    <section className={styles.card} aria-label="Dashboard menu"><StaffToolNav variant="dashboard" includePersonal={!isKiosk} /></section>
    <details className={styles.card}>
      <summary style={{ cursor: 'pointer', fontWeight: 700, padding: '8px 0' }}>My shift{isOwner ? ' & administration' : ''}</summary>
      <div className={styles.links} style={{ marginTop: 16 }}>
        <Link href="/employee">{isKiosk ? 'My Timecards' : 'My PIN & Timecards'}</Link>
        {isOwner && <><Link href="/staff/team">Staff & Timecards</Link><Link href="/staff/campaigns">Email campaigns</Link><Link href="/staff/founding-memberships">Founding memberships</Link></>}
        {roles.includes('instructor') && <Link href="/teaching">Teaching Classes</Link>}
      </div>
    </details>
  </main>;
}
