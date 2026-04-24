import Link from 'next/link';
import { getCurrentUserRole } from '@/lib/authz';
import StaffDashboard from '@/components/staff/StaffDashboard';

export default async function StaffPage() {
  const { role } = await getCurrentUserRole();

  return (
    <main style={{ padding: 24, maxWidth: 1180, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <p style={{ margin: 0, color: '#7a63a5', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Little Wanderers operator tools</p>
          <h1 style={{ margin: '8px 0 0', color: '#4f3f82' }}>Staff / Owner Dashboard</h1>
          <p style={{ margin: '8px 0 0', color: '#6d6480' }}>Signed in with role: <strong>{role ?? 'unknown'}</strong></p>
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Link href="/staff/checkin" style={{ padding: '10px 14px', borderRadius: 999, border: '1px solid #d7c1f7', background: '#fff', color: '#5f3da4', textDecoration: 'none', fontWeight: 700 }}>Open staff QR check-in</Link>
          <Link href="/landing" style={{ padding: '10px 14px', borderRadius: 999, border: '1px solid #e4dbf5', background: '#f8f3ff', color: '#5f3da4', textDecoration: 'none', fontWeight: 700 }}>Customer Dashboard</Link>
        </div>
      </div>

      <StaffDashboard />
    </main>
  );
}
