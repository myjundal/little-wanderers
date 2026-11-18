import { loadPublicOpenPlaySlots } from '@/lib/public-open-play';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store, max-age=0' };

// Public availability only. Actual booking rechecks capacity in the write path.
export async function GET() {
  try {
    const slots = await loadPublicOpenPlaySlots(createAdminSupabaseClient());
    return Response.json({ ok: true, slots }, { headers });
  } catch {
    return Response.json({ ok: false, error: 'Unable to confirm availability.' }, { status: 503, headers });
  }
}
