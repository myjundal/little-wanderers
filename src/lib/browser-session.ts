import { createBrowserSupabaseClient } from '@/lib/supabase/browser';
import { withAuthDeadline } from '@/lib/auth-request';

/** Persist the verified browser session on this host before any server-protected navigation. */
export async function persistBrowserSession() {
  const supabase = createBrowserSupabaseClient();
  const { data, error } = await withAuthDeadline(() => supabase.auth.getSession());
  if (error || !data.session) throw new Error('Your sign-in session is missing. Please request a new sign-in link.');
  const response = await withAuthDeadline(() => fetch('/api/auth/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ access_token: data.session!.access_token, refresh_token: data.session!.refresh_token }) }));
  if (!response.ok) throw new Error('Your sign-in could not be saved. Please enable cookies for this site and try again.');
}
