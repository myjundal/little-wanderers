// src/app/auth/callback/page.tsx
'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabaseClient';

export default function CallbackPage() {
  const router = useRouter();

  useEffect(() => {
    const handleCallback = async () => {
      const { data, error } = await supabaseBrowser.auth.getSession();

      if (data.session) {
        // ✅ 세션 있으면 로그인 성공
        router.replace('/landing');
      } else {
        // ❌ 세션 없으면 로그인 페이지로
        router.replace('/login');
      }
    };

    handleCallback();
  }, []);

  return <p>Logging in...</p>;
}

