import { cookies } from 'next/headers';
import type { User } from '@supabase/supabase-js';
import { ACCOUNT_LINK_COOKIE, readAccountLink, linkVerifiedFamilyLogins } from '@/lib/account-link';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';

export async function completeAccountLink(user: User): Promise<string | null> {
  const store = await cookies();
  const value = store.get(ACCOUNT_LINK_COOKIE)?.value;
  if (!value) return null;
  store.delete(ACCOUNT_LINK_COOKIE);
  const intent = readAccountLink(value);
  if (!intent) return '/landing/people?account_link=expired';
  try {
    await linkVerifiedFamilyLogins(createAdminSupabaseClient(), user, intent);
    return '/landing/people?account_link=connected';
  } catch { return '/landing/people?account_link=review'; }
}
