import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
export async function createServerSupabaseClient() {
  const store = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => store.getAll(),
      setAll(values) { try { values.forEach(({ name, value, options }) => store.set(name, value, options)); } catch { /* Middleware refreshes cookies before Server Components render. */ } },
    },
  });
}
