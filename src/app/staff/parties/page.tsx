import { getCurrentUserRole } from '@/lib/authz';
import StaffDashboard from '@/components/staff/StaffDashboard';
import StaffToolNav from '@/components/staff/StaffToolNav';
import PartyManagement from '@/components/staff/PartyManagement';

export const metadata = { title: 'Party Management - Little Wanderers' };

export default async function StaffPartiesPage() {
  const { role } = await getCurrentUserRole();

  return (
    <main style={{ padding: 24, maxWidth: 1180, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <p style={{ margin: 0, color: '#7a63a5', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Little Wanderers operator tools</p>
          <h1 style={{ margin: '8px 0 0', color: '#4f3f82' }}>Party Management</h1>
          <p style={{ margin: '8px 0 0', color: '#6d6480' }}>Signed in with role: <strong>{role ?? 'unknown'}</strong></p>
        </div>
        <StaffToolNav active="parties" />
      </div>

      <PartyManagement />
      {(role === 'owner' || role === 'admin') && <details style={{ marginTop: 32 }}>
        <summary style={{ padding: 16, cursor: 'pointer', color: '#5f3da4', fontWeight: 700 }}>All bookings &amp; requests</summary>
        <StaffDashboard view="parties" />
      </details>}
    </main>
  );
}
