import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export type AppRole = 'user' | 'owner' | 'staff' | 'admin';

export function isStaffRole(role: string | null | undefined): role is AppRole {
  return role === 'owner' || role === 'staff' || role === 'admin';
}

export async function getCurrentUserRole() {
  const server = createServerSupabaseClient();
  const {
    data: { user },
  } = await server.auth.getUser();

  if (!user) {
    return { user: null, role: null as string | null };
  }

  const admin = createAdminSupabaseClient();
  const { data: roleRow } = await admin.from('roles').select('role').eq('id', user.id).maybeSingle();

  return {
    user,
    role: roleRow?.role ?? null,
  };
}

export async function requireStaffContext() {
  const { user, role } = await getCurrentUserRole();

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
    admin: createAdminSupabaseClient(),
  };
}
