import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getCurrentUserRole } from '@/lib/authz';
import { canViewRevenue } from '@/lib/revenue-access';
import { revenueDay } from '@/lib/service-day-revenue';
import OwnerRevenue from '@/components/staff/OwnerRevenue';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Private revenue · Little Wanderers', robots: { index: false, follow: false } };
export default async function RevenuePage() {
  if (!canViewRevenue(await getCurrentUserRole())) notFound();
  return <OwnerRevenue initialDate={revenueDay(new Date())} />;
}
