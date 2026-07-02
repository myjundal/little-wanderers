import { PastelHeader } from '@/components/pastel/PastelPrimitives';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getWaitlistCount } from '@/lib/waitlist-count';

export default async function Nav() {
  const supabase = createServerSupabaseClient();
  const [{ data }, waitlistCount] = await Promise.all([
    supabase.auth.getUser(),
    getWaitlistCount(),
  ]);

  return (
    <PastelHeader
      isAuthenticated={Boolean(data.user)}
      waitlistCount={{ displayCount: waitlistCount.displayCount }}
    />
  );
}
