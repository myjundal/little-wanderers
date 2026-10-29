import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { getLatestHouseholdIdForUser } from '@/lib/households';
import { changeSquareMembership } from '@/lib/square-checkout';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export async function POST() {
  try {
    const server = await createServerSupabaseClient();
    const { data: { user } } = await server.auth.getUser();
    if (!user) return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    const admin = createAdminSupabaseClient();
    const householdId = await getLatestHouseholdIdForUser(admin, user.id);
    if (!householdId) return Response.json({ ok: false, error: 'household not found' }, { status: 404 });
    const result = await changeSquareMembership(admin, householdId, 'pause');
    return Response.json({ ok: true, ...result });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : 'Unable to update subscription' }, { status: 502 });
  }
}
