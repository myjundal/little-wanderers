import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getCurrentUserRole } from '@/lib/authz';
import { getKioskDevice, KIOSK_DEVICE_COOKIE, KIOSK_SESSION_COOKIE, kioskCookieOptions, sameOrigin } from '@/lib/staff-kiosk';
import { validStaffPin, verifyStaffPin, staffTokenHash, newStaffToken } from '@/lib/staff-pin';
export const dynamic = 'force-dynamic';
const fail = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status, headers: { 'Cache-Control': 'no-store' } });
export async function GET() {
  const device = await getKioskDevice();
  if (!device) return NextResponse.json({ ok: true, paired: false, staff: [] }, { headers: { 'Cache-Control': 'no-store' } });
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin.from('staff_profiles').select('user_id,display_name,pin_hash').eq('active', true).not('pin_hash', 'is', null).order('display_name');
  if (error) return fail('Unable to load staff login. Run the staff timeclock migration.', 503);
  const { data: { user } } = await (await createServerSupabaseClient()).auth.getUser();
  const identity = await getCurrentUserRole();
  return NextResponse.json({ ok: true, paired: true, device_name: device.name, personal_session: Boolean(user), signed_in: identity.isKiosk, has_shift_session: Boolean((await cookies()).get(KIOSK_SESSION_COOKIE)?.value), staff: (data ?? []).map(row => ({ id: row.user_id, name: row.display_name })) }, { headers: { 'Cache-Control': 'no-store' } });
}
export async function POST(req: Request) {
  if (!sameOrigin(req)) return fail('Invalid request origin.', 403);
  const deviceToken = (await cookies()).get(KIOSK_DEVICE_COOKIE)?.value;
  if (!deviceToken || !await getKioskDevice()) return fail('An owner must register this iPad first.', 403);
  let body: { action?: string; user_id?: string; pin?: string };
  try { body = await req.json(); } catch { return fail('Invalid request.'); }
  if (body.action === 'signout_personal') {
    const { error } = await (await createServerSupabaseClient()).auth.signOut({ scope: 'local' });
    if (error) return fail('Could not sign out of this device. Please try again.', 503);
    return NextResponse.json({ ok: true });
  }
  if (body.action === 'logout') {
    const token = (await cookies()).get(KIOSK_SESSION_COOKIE)?.value;
    if (!token) return fail('No iPad shift session was found.', 409);
    const { data, error } = await createAdminSupabaseClient().rpc('staff_kiosk_clock_out', { p_session_hash: staffTokenHash(token), p_device_hash: staffTokenHash(deviceToken) });
    if (error || !data?.ok) return fail(data?.error ?? 'Clock-out failed. Your shift remains open; try again or ask the owner.', 409);
    const response = NextResponse.json({ ok: true, clock_out: data.clock_out });
    response.cookies.set(KIOSK_SESSION_COOKIE, '', { ...kioskCookieOptions, maxAge: 0 });
    return response;
  }
  if (body.action !== 'login' || !validStaffPin(body.pin) || !body.user_id || !/^[0-9a-f-]{36}$/i.test(body.user_id)) return fail('Choose your name and enter your 4-digit PIN.');
  const { data: { user: personalUser } } = await (await createServerSupabaseClient()).auth.getUser();
  if (personalUser) return fail('Sign out of the personal account on this iPad before starting a shift.', 409);
  if ((await cookies()).get(KIOSK_SESSION_COOKIE)?.value && (await getCurrentUserRole()).isKiosk) return fail('The previous employee must log out first.', 409);
  const admin = createAdminSupabaseClient();
  const { data: attempt, error } = await admin.rpc('staff_kiosk_begin_attempt', { p_device_hash: staffTokenHash(deviceToken), p_user_id: body.user_id });
  if (error) return fail('Staff login is not ready. Ask the owner.', 503);
  if (!attempt?.ok) return fail(attempt?.error ?? 'Login is unavailable.', 429);
  if (!verifyStaffPin(body.pin, attempt.pin_hash)) return fail('Name or PIN is incorrect.', 401);
  const [{ data: primary }, { data: extra }] = await Promise.all([admin.from('roles').select('role').eq('id', body.user_id).maybeSingle(), admin.from('user_roles').select('role').eq('user_id', body.user_id)]);
  const roles = [primary?.role, ...(extra ?? []).map(row => row.role)];
  if (!roles.some(role => ['staff','instructor','owner','admin'].includes(role))) return fail('Staff access has been removed.', 403);
  const token = newStaffToken();
  const { data: result, error: clockError } = await admin.rpc('staff_kiosk_clock_in', { p_device_hash: staffTokenHash(deviceToken), p_user_id: body.user_id, p_session_hash: staffTokenHash(token), p_pin_version: attempt.pin_version });
  if (clockError || !result?.ok) return fail(result?.error ?? 'Could not record clock-in. Please try again.', 409);
  const response = NextResponse.json({ ok: true, clock_in: result.clock_in, next: roles.some(role => ['staff','owner','admin'].includes(role)) ? '/staff/dashboard' : '/teaching' });
  response.cookies.set(KIOSK_SESSION_COOKIE, token, { ...kioskCookieOptions, maxAge: 7 * 86400 });
  return response;
}
