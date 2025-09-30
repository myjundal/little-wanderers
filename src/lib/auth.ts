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
          return cookie ? cookie.value : null;
        },
        set: (name: string, value: string, options) => {
          cookieStore.set({ name, value, ...options });
        },
        remove: (name: string, options) => {
          cookieStore.delete(name, options);
        },
      },
    }
  );
};

