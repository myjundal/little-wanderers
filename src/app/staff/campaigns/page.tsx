import Link from 'next/link';
import CampaignAdmin from '@/components/staff/CampaignAdmin';

export const metadata = { title: 'Email Campaigns — Little Wanderers' };

export default function StaffCampaignsPage() {
  return (
    <main style={{ padding: 24, maxWidth: 1280, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <p style={{ margin: 0, color: '#7a63a5', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Owner tools</p>
          <h1 style={{ margin: '8px 0 0', color: '#4f3f82' }}>Email Campaigns</h1>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Link href="/" style={{ borderRadius: 12, border: '1px solid #d9c8f7', padding: '10px 14px', color: '#5f3da4', textDecoration: 'none', fontWeight: 700 }}>
            Homepage
          </Link>
          <Link href="/staff" style={{ borderRadius: 12, border: '1px solid #d9c8f7', padding: '10px 14px', color: '#5f3da4', textDecoration: 'none', fontWeight: 700 }}>
            Staff dashboard
          </Link>
        </div>
      </div>
      <CampaignAdmin />
    </main>
  );
}
