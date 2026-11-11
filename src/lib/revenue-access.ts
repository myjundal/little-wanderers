import { getCurrentUserRole } from '@/lib/authz';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';

// The verified personal owner account. Household ownership and admin access do
// not grant access to financial reports. PIN sessions are always excluded.
const REVENUE_OWNER_ID = '5054a175-2ba6-4023-a289-a9b0635ccc5f';
export function canViewRevenue(context: { user: { id: string } | null; role: string | null; isKiosk: boolean }) {
  return !context.isKiosk && context.role === 'owner' && context.user?.id === REVENUE_OWNER_ID;
}

export async function requireRevenueContext() {
  const context = await getCurrentUserRole();
  if (!canViewRevenue(context)) return { ok: false as const, response: Response.json(
    { ok: false, error: context.user ? 'Private owner access required.' : 'Please sign in.' },
    { status: context.user ? 403 : 401, headers: { 'Cache-Control': 'private, no-store' } },
  ) };
  return { ok: true as const, admin: createAdminSupabaseClient() };
}
