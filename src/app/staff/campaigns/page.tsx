import CampaignAdmin from '@/components/staff/CampaignAdmin';
import StaffToolNav from '@/components/staff/StaffToolNav';

export const metadata = { title: 'Email Campaigns — Little Wanderers' };

export default function StaffCampaignsPage() {
  return (
    <main style={{ padding: 24, maxWidth: 1280, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <p style={{ margin: 0, color: '#7a63a5', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Owner tools</p>
          <h1 style={{ margin: '8px 0 0', color: '#4f3f82' }}>Email Campaigns</h1>
        </div>
        <StaffToolNav active="campaigns" />
      </div>
      <CampaignAdmin />
    </main>
  );
}
