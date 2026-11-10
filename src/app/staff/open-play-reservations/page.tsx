'use client';
import { useRouter } from 'next/navigation';
import OpenPlayReservationsAdmin from '@/components/staff/OpenPlayReservationsAdmin';
import StaffToolNav from '@/components/staff/StaffToolNav';
import { useOperatorAccess } from '@/lib/use-owner-dashboard-access';
export default function StaffOpenPlayReservationsPage() {
  const router = useRouter();
  const { role } = useOperatorAccess();
  return <main style={{ maxWidth: 1100, margin: '0 auto', padding: 24 }}><StaffToolNav active="open-play" /><h1>Open Play reservations</h1><OpenPlayReservationsAdmin canManage={role === 'owner' || role === 'admin'} onCheckIn={id => router.push(`/staff/checkin?family=${encodeURIComponent(id)}`)} /></main>;
}
