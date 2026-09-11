import { getCurrentUserRole } from '@/lib/authz';
import StaffToolNav from '@/components/staff/StaffToolNav';
import OpenPlayReservationsAdmin from '@/components/staff/OpenPlayReservationsAdmin';

export const metadata = { title: 'Open Play Reservations - Little Wanderers' };

export default async function StaffOpenPlayReservationsPage() {
  const { role } = await getCurrentUserRole();

  return (
    <main style={{ padding: 24, maxWidth: 1180, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <p style={{ margin: 0, color: '#7a63a5', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Little Wanderers operator tools</p>
          <h1 style={{ margin: '8px 0 0', color: '#4f3f82' }}>Manage Open Play Reservations</h1>
          <p style={{ margin: '8px 0 0', color: '#6d6480' }}>Signed in with role: <strong>{role ?? 'unknown'}</strong></p>
        </div>
        <StaffToolNav active="openPlayReservations" />
      </div>

      <OpenPlayReservationsAdmin />
    </main>
  );
}
