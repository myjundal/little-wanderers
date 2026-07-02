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
          try {
            cookieStore.set({ name, value, ...options });
          } catch {
            // Server Components cannot always write refreshed auth cookies.
          }
        },
        remove: (name: string, options) => {
          try {
            cookieStore.delete({ name, ...options });
          } catch {
            // Server Components cannot always write refreshed auth cookies.
          }
        },
      },
    }
  );
};
