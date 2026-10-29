import { onlinePaymentsUnavailable } from '@/lib/online-payment-access';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { getLatestHouseholdIdForUser } from '@/lib/households';
import { startSquareCheckout } from '@/lib/square-checkout';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export async function POST() {
  const unavailable = onlinePaymentsUnavailable('membership');
  if (unavailable) return unavailable;
  try {
    const server = await createServerSupabaseClient();
    const { data: { user } } = await server.auth.getUser();
    if (!user) return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    const admin = createAdminSupabaseClient();
    const householdId = await getLatestHouseholdIdForUser(admin, user.id);
    if (!householdId) return Response.json({ ok: false, error: 'household not found' }, { status: 404 });
    const result = await startSquareCheckout(admin, { householdId, userId: user.id, role: 'customer',
      kind: 'membership', email: user.email, returnPath: '/landing/membership?success=1' });
    return Response.json({ ok: true, url: result.url, checkout_id: result.id });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : 'Unable to start subscription' }, { status: 502 });
  }
}
