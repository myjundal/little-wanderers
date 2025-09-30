import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { redirect } from 'next/navigation';

export default async function LandingLayout({ children }: { children: ReactNode }) {
  console.log('Supabase URL:', process.env.SUPABASE_URL);
  console.log('Supabase KEY:', process.env.SUPABASE_ANON_KEY);

  const supabase = createServerClient({
    cookies,
    supabaseUrl: process.env.SUPABASE_URL ?? '',
    supabaseKey: process.env.SUPABASE_ANON_KEY ?? '',
  });

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    redirect('/login');
  }

  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

