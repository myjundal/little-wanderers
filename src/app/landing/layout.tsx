import { headers } from 'next/headers';
import { safeAuthNextPath } from '@/lib/auth-redirect';
import StaffSessionBar from '@/components/staff/StaffSessionBar';
import StaffQuickNav from '@/components/staff/StaffQuickNav';
import { ReactNode } from 'react';
import { supabaseServer } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { PastelDashboardShell } from '@/components/pastel/PastelShells';
import LandingMoreMenu from '@/components/landing/LandingMoreMenu';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    const next = safeAuthNextPath((await headers()).get('x-lw-next-path'), 'https://thelittlewanderers.com');
    redirect(`/login?next=${encodeURIComponent(next)}`);
  }
  return <PastelDashboardShell><LandingMoreMenu /><StaffSessionBar />{children}<StaffQuickNav /></PastelDashboardShell>;
}
