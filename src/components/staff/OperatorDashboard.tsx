import StaffToolNav from './StaffToolNav';
import styles from './StaffPortal.module.css';

export default function OperatorDashboard({ role, isKiosk, displayName }: {
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
  </main>;
}
