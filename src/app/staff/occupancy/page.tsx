import StaffDashboard from '@/components/staff/StaffDashboard';
import StaffToolNav from '@/components/staff/StaffToolNav';
export default function OccupancyPage() {
  return <main style={{ padding: 24, maxWidth: 1180, margin: '0 auto' }}><StaffToolNav /><h1>Occupancy Management</h1><StaffDashboard view="occupancy" /></main>;
}
