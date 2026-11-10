'use client';

import { createBrowserClient } from '@supabase/ssr';
import { fetchWithAuthTimeout } from '@/lib/auth-request';

export const createBrowserSupabaseClient = () => {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { fetch: fetchWithAuthTimeout } },
  );
};

