// Read-only production smoke checks. Never print credentials or customer records.
import nextEnv from '@next/env';
import { createClient } from '@supabase/supabase-js';

nextEnv.loadEnvConfig(process.cwd());
const base = process.env.AUDIT_SITE_URL || 'https://www.thelittlewanderers.com';
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const tables = ['households', 'household_members', 'people', 'waivers', 'memberships', 'pricing_rules', 'checkins', 'classes', 'class_registrations', 'open_play_reservation_slots', 'open_play_reservations', 'party_bookings', 'roles', 'user_roles', 'staff_profiles', 'staff_time_entries'];
await Promise.all(tables.map(async table => {
  const { count, error } = await admin.from(table).select('*', { count: 'exact', head: true });
  console.log(JSON.stringify({ table, count, error: error ? { code: error.code, message: error.message } : null }));
}));
const { data: waivers, error } = await admin.from('waivers').select('household_id,signed_at,signed_date,waiver_expires_at,electronic_signature,source').limit(1000);
console.log(JSON.stringify({ waiver_summary: error ? { code: error.code, message: error.message } : {
  rows: waivers.length, linked: waivers.filter(row => row.household_id).length,
  signed: waivers.filter(row => row.signed_at || row.signed_date).length,
  with_signature: waivers.filter(row => row.electronic_signature).length,
  sources: [...new Set(waivers.map(row => row.source))],
} }));
await Promise.all(['/', '/login', '/api/classes', '/api/crowd-level', '/api/waitlist-count', '/staff/classes', '/api/admin/families', '/api/teaching', '/api/push/preferences'].map(async path => {
  const start = Date.now();
  const response = await fetch(new URL(path, base), { redirect: 'manual', signal: AbortSignal.timeout(20000) });
  console.log(JSON.stringify({ path, status: response.status, location: response.headers.get('location'), ms: Date.now() - start }));
}));
