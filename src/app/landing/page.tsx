'use client';
import { useEffect, useState } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase/browser';
import Link from 'next/link';

export default function AppHome() {
  const [email, setEmail] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const run = async () => {
      const supabase = createBrowserSupabaseClient();

      // session
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
      setEmail(user?.email ?? null);
      if (!user){setReady(true);
	return;}

      // household 존재 확인
      const { data: found, error } = await supabase
        .from('households')
        .select('id')
        .eq('owner_user_id', user.id)
	.order('created_at', {ascending: false })
        .limit(1);

	// if not existing, create
      if (!found || found.length === 0) {
        await supabase
	  .from('households')
	  .upsert(
	    {
          owner_user_id: user.id,
          name: (user.email ?? 'My Household').split('@')[0],
        },
	{ onConflict: 'owner_user_id' }
	);
      }

      setReady(true);
    };
    run();
  }, []);

  if (!ready) return <main style={{ padding: 24 }}>Loading…</main>;

  if (!email) {
    return (
      <main style={{ padding: 24 }}>
        <h1>Please login</h1>
        <p><Link href="/">Back to Homepage</Link></p>
      </main>
    );
  }

  return (
    <main style={{ padding: 24 }}>
      <h1>Welcome 👋</h1>
      <p>Email: {email}</p>
      <ul style={{ marginTop: 16 }}>
        <li><Link href="/landing/people">My People</Link></li>
        <li><Link href="/landing/qr">My QR Codes</Link></li>
        <li><Link href="/landing/membership">My Membership (In progress)</Link></li>
        <li><Link href="/landing/party">My Party Bookings (In progress)</Link></li>
      </ul>
    </main>
  );
}

