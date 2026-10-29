import StaffSessionBar from '@/components/staff/StaffSessionBar';
import { ReactNode } from 'react';
import { supabaseServer } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { PastelDashboardShell } from '@/components/pastel/PastelShells';
import LandingMoreMenu from '@/components/landing/LandingMoreMenu';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect('/login');
  return <PastelDashboardShell><LandingMoreMenu /><StaffSessionBar />{children}</PastelDashboardShell>;
}
