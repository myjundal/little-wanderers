import { getKioskIdentity } from '@/lib/staff-kiosk';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export type AppRole = 'user' | 'owner' | 'staff' | 'admin' | 'instructor';

export function isStaffRole(role: string | null | undefined): role is AppRole {
  return role === 'owner' || role === 'staff' || role === 'admin';
}

export async function getCurrentUserRole() {
  const server = await createServerSupabaseClient();
  const [kiosk, { data: { user: personalUser } }] = await Promise.all([
    getKioskIdentity(),
    server.auth.getUser(),
  ]);
  const admin = createAdminSupabaseClient();
  const user = kiosk ? (await admin.auth.admin.getUserById(kiosk.user_id)).data.user : personalUser;

  if (!user) {
    return { user: null, role: null as string | null, roles: [] as string[], isKiosk: false };
  }

  const [{ data: roleRow }, { data: extraRoles, error }] = await Promise.all([
    admin.from('roles').select('role').eq('id', user.id).maybeSingle(),
    admin.from('user_roles').select('role').eq('user_id', user.id),
  ]);
  if (error && error.code !== '42P01' && error.code !== 'PGRST205') throw new Error('Unable to load account permissions.');
  let roles = [...new Set([roleRow?.role, ...(extraRoles ?? []).map(row => row.role)].filter((value): value is string => Boolean(value)))];
  if (kiosk) {
    if (!roles.some(value => ['owner','admin','staff','instructor'].includes(value))) return { user: null, role: null, roles: [], isKiosk: false };
    roles = [...new Set([...roles.filter(value => value === 'staff' || value === 'instructor'), ...(['owner','admin'].some(value => roles.includes(value)) ? ['staff'] : [])])];
  }
  const role = ['owner', 'admin', 'staff', 'instructor', 'user'].find(value => roles.includes(value)) ?? null;
  return { user, role, roles, isKiosk: Boolean(kiosk) };
}

export async function requireStaffContext() {
  const { user, role, isKiosk } = await getCurrentUserRole();

  if (!user) {
    return {
      ok: false as const,
      response: Response.json({ ok: false, error: 'unauthorized' }, { status: 401 }),
    };
  }

  if (!isStaffRole(role)) {
    return {
      ok: false as const,
      response: Response.json({ ok: false, error: 'forbidden' }, { status: 403 }),
    };
  }

  return {
    ok: true as const,
    user,
    role,
    isKiosk,
    admin: createAdminSupabaseClient(),
  };
}

export async function requireOwnerContext() {
  const context = await requireStaffContext();
  if (!context.ok) return context;
  if (context.role === 'staff') {
    return { ok: false as const, response: Response.json({ ok: false, error: 'Owner access required.' }, { status: 403 }) };
  }
  return context;
}

export async function requireTeachingContext() {
  const { user, role, roles } = await getCurrentUserRole();
  if (!user) return { ok: false as const, response: Response.json({ ok: false, error: 'unauthorized' }, { status: 401 }) };
  if (!roles.includes('instructor') && role !== 'owner' && role !== 'admin') {
    return { ok: false as const, response: Response.json({ ok: false, error: 'forbidden' }, { status: 403 }) };
  }
  return { ok: true as const, user, role, roles, admin: createAdminSupabaseClient() };
}

export async function requireClassAttendanceContext(classId: string) {
  const context = await requireTeachingContext();
  if (!context.ok) return context;
  if (context.role === 'owner' || context.role === 'admin') return context;
  const { data, error } = await context.admin.from('class_instructors').select('class_id').eq('class_id', classId).eq('user_id', context.user.id).maybeSingle();
  if (error) return { ok: false as const, response: Response.json({ ok: false, error: 'Unable to verify class assignment.' }, { status: 500 }) };
  if (!data) return { ok: false as const, response: Response.json({ ok: false, error: 'Class access denied.' }, { status: 403 }) };
  return context;
}
