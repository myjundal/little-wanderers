import { getCurrentUserRole, isStaffRole } from '@/lib/authz';
export const dynamic = 'force-dynamic';
export async function GET() {
  const { user, role, roles, isKiosk } = await getCurrentUserRole();
  return Response.json({ ok: true, is_staff: Boolean(user && isStaffRole(role)), role: user ? role : null, roles, is_kiosk: isKiosk });
}
