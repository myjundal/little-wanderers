import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';

export function createServerSupabaseClient() {
	const cookieStore = cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
	get(name) {
		return cookieStore.get(name)?.value;
		},
	set(name, value, options) {
		try {
			cookieStore.set({ name, value, ...options });
		} catch {
			// Server Components cannot always write refreshed auth cookies.
		}
		},
	remove(name, options) {
		try {
			cookieStore.delete({ name, ...options });
		} catch {
			// Server Components cannot always write refreshed auth cookies.
		}
		},
	},
    }
  );
}
