'use client';

import { useEffect } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase/browser';

export default function AuthLinkLandingGuard() {
  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);

    if (searchParams.has('code') || searchParams.has('token_hash')) {
      window.location.replace(`/auth/link?${searchParams.toString()}`);
      return;
    }

    if (!window.location.hash.includes('access_token') && !window.location.hash.includes('refresh_token')) {
      return;
    }

    const finishHashAuth = async () => {
      const fragment = new URLSearchParams(window.location.hash.slice(1));
      const accessToken = fragment.get('access_token');
      const refreshToken = fragment.get('refresh_token');
      if (!accessToken || !refreshToken) return;
      const next = searchParams.get('next') || (fragment.get('type') === 'invite' ? '/employee' : '/landing');
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
      const supabase = createBrowserSupabaseClient();
      const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
      if (error) return;
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (session) {
        window.location.replace(`/auth/finish?next=${encodeURIComponent(next)}`);
      }
    };

    void finishHashAuth();
  }, []);

  return null;
}
