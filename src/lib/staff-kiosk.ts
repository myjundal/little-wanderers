import { cookies } from 'next/headers';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { staffTokenHash } from '@/lib/staff-pin';
export const KIOSK_DEVICE_COOKIE = 'lw_staff_device';
export const KIOSK_SESSION_COOKIE = 'lw_staff_session';
export const kioskCookieOptions = { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict' as const, path: '/' };
export function sameOrigin(req: Request) {
  const origin = req.headers.get('origin');
  try { return Boolean(origin && new URL(origin).host === req.headers.get('host')); } catch { return false; }
}
export async function getKioskDevice() {
  const token = (await cookies()).get(KIOSK_DEVICE_COOKIE)?.value;
  if (!token) return null;
  const { data, error } = await createAdminSupabaseClient().from('staff_kiosk_devices').select('id,name').eq('secret_hash', staffTokenHash(token)).eq('active', true).maybeSingle();
  return error ? null : data;
}
export async function getKioskIdentity() {
  const token = (await cookies()).get(KIOSK_SESSION_COOKIE)?.value;
  const device = await getKioskDevice();
  if (!token || !device) return null;
  const admin = createAdminSupabaseClient();
  const { data: session } = await admin.from('staff_kiosk_sessions').select('user_id,pin_version,expires_at').eq('token_hash', staffTokenHash(token)).eq('device_id', device.id).is('revoked_at', null).gt('expires_at', new Date().toISOString()).maybeSingle();
  if (!session) return null;
  const { data: profile } = await admin.from('staff_profiles').select('user_id,display_name,pin_version').eq('user_id', session.user_id).eq('active', true).maybeSingle();
  if (!profile || session.pin_version !== profile.pin_version) return null;
  const { data: shift } = await admin.from('staff_time_entries').select('id').eq('session_hash', staffTokenHash(token)).is('clock_out', null).maybeSingle();
  return shift ? profile : null;
}
