'use client';
import { useEffect, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabaseClient';
import Link from 'next/link';

export default function AppHome() {
  const [email, setEmail] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const run = async () => {
      const supabase = supabaseBrowser;

      // 유저
      const { data: userData } = await supabase.auth.getUser();
      const user = userData.user;
      setEmail(user?.email ?? null);
      if (!user) return setReady(true);

      // household 존재 확인
      const { data: hs } = await supabase
        .from('households')
        .select('id')
        .eq('owner_user_id', user.id)
        .maybeSingle();

      if (!hs) {
        // 없으면 생성
        await supabase.from('households').insert({
          owner_user_id: user.id,
          name: (user.email ?? 'My Household').split('@')[0],
        });
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
        <p><a href="/">Back to Homepage</a></p>
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

