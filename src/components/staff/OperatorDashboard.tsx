import MembershipManagementSummary from './MembershipManagementSummary';
import StaffToolNav from './StaffToolNav';
import styles from './StaffPortal.module.css';

export default function OperatorDashboard({ role, isKiosk, displayName, canViewPrivateRevenue = false }: {
  role: string | null;
  roles: string[];
  isKiosk: boolean;
  displayName?: string | null;
  canViewPrivateRevenue?: boolean;
}) {
  const isOwner = role === 'owner' || role === 'admin';
  return <main className={styles.main}>
    <h1>{isOwner ? 'Owner Dashboard' : 'Staff Dashboard'}</h1>
    {displayName && <p>Hello, {displayName}</p>}
    {isKiosk && <p>Your shift started when you entered your PIN. Use “Log out & clock out” when you finish.</p>}
    <section className={styles.card} aria-label="Dashboard menu"><StaffToolNav variant="dashboard" includePersonal={!isKiosk} includeMembershipManagement={isOwner} /></section>
    {canViewPrivateRevenue && <section className={styles.card}><div className={styles.links}><Link href="/staff/revenue">Private revenue · 방문일 기준 매출</Link></div><p className={styles.subtle}>본인 전용 · 선결제도 방문일에 반영</p></section>}
    {isOwner && <MembershipManagementSummary />}
  </main>;
}
import Link from 'next/link';
