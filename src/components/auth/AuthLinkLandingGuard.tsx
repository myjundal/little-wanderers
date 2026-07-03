'use client';

import { useEffect } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase/browser';

export default function AuthLinkLandingGuard() {
  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);

    if (searchParams.has('code') || searchParams.has('token_hash')) {
      window.location.replace(`/auth/callback?${searchParams.toString()}`);
      return;
    }

    if (!window.location.hash.includes('access_token') && !window.location.hash.includes('refresh_token')) {
      return;
    }

    const finishHashAuth = async () => {
      const supabase = createBrowserSupabaseClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (session) {
        window.location.replace('/auth/finish');
      }
    };

    void finishHashAuth();
  }, []);

  return null;
}
