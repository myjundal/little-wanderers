import { ReactNode } from 'react';
import { supabaseServer } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { PastelDashboardShell } from '@/components/pastel/PastelShells';
import LandingMoreMenu from '@/components/landing/LandingMoreMenu';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const supabase = supabaseServer();
  const { data: { session } } = await supabase.auth.getSession();

  if (!session) redirect('/?signin=1'); // no session → send back to public page
  return <PastelDashboardShell><LandingMoreMenu />{children}</PastelDashboardShell>;
}
