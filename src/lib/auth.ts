import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export const supabaseServer = () => {
  const cookieStore = cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get: (name: string) => {
          const cookie = cookieStore.get(name);
          return cookie ? cookie.value : null; // 값만 반환
        },
        set: (name: string, value: string, options) => {
          cookieStore.set({ name, value, ...options });
        },
        delete: (name: string, options) => {
          cookieStore.set({ name, value: '', ...options });
        },
      },
    }
  );
};

