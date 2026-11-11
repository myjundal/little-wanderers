import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSquareModules } from './helpers/admission-pos-harness.mjs';
test('resuming an active PIN shift returns the same role-appropriate dashboard as clock-in', async () => {
  for (const [role, expected] of [['staff', '/staff/dashboard'], ['instructor', '/teaching']]) {
    const admin = { from(table) { assert.equal(table, 'staff_profiles'); const q = { select() { return q; }, eq() { return q; }, not() { return q; }, order: async () => ({ data: [], error: null }) }; return q; } };
    const modules = loadSquareModules({ mocks: {
      'next/server': { NextResponse: { json: Response.json } }, 'next/headers': { cookies: async () => ({ get: () => ({ value: 'existing-shift' }) }) },
      '@/lib/supabase/admin': { createAdminSupabaseClient: () => admin }, '@/lib/supabase/server': { createServerSupabaseClient: async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }) },
      '@/lib/authz': { getCurrentUserRole: async () => ({ role, isKiosk: true }) }, '@/lib/staff-pin': {},
      '@/lib/staff-kiosk': { getKioskDevice: async () => ({ name: 'Staff iPad' }) },
    } });
    const result = await (await modules.load('src/app/api/staff/kiosk/route.ts').GET()).json();
    assert.equal(result.signed_in, true); assert.equal(result.next, expected);
  }
});
