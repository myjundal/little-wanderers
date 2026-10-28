import { NextResponse } from 'next/server';
import { requireOwnerContext } from '@/lib/authz';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { KIOSK_DEVICE_COOKIE, KIOSK_SESSION_COOKIE, kioskCookieOptions, sameOrigin } from '@/lib/staff-kiosk';
import { newStaffToken, staffTokenHash } from '@/lib/staff-pin';
export const dynamic = 'force-dynamic';
const fail = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status });
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9-]{36}$/i.test(value);
export async function GET() {
  const context = await requireOwnerContext();
  if (!context.ok) return context.response;
  const admin = context.admin;
  const [profiles, entries, devices] = await Promise.all([
    admin.from('staff_profiles').select('user_id,display_name,active,pin_hash,created_at').order('display_name'),
    admin.from('staff_time_entries').select('id,user_id,clock_in,clock_out,closed_by,close_note').order('clock_in', { ascending: false }).limit(1000),
    admin.from('staff_kiosk_devices').select('id,name,active,created_at').order('created_at', { ascending: false }),
  ]);
  if (profiles.error || entries.error || devices.error) return fail('Staff timeclock setup is not ready. Run the staff timeclock migration.', 503);
  const staff = [];
  for (const profile of profiles.data ?? []) {
    const { data, error } = await admin.auth.admin.getUserById(profile.user_id);
    if (error) return fail('Unable to load staff accounts.', 500);
    staff.push({ user_id: profile.user_id, display_name: profile.display_name, active: profile.active, pin_set: Boolean(profile.pin_hash), email: data.user?.email ?? '' });
  }
  return NextResponse.json({ ok: true, staff, entries: entries.data, devices: devices.data, entries_limited: (entries.data?.length ?? 0) === 1000 }, { headers: { 'Cache-Control': 'no-store' } });
}
export async function POST(req: Request) {
  if (!sameOrigin(req)) return fail('Invalid request origin.', 403);
  const context = await requireOwnerContext();
  if (!context.ok) return context.response;
  let body: { action?: string; email?: string; display_name?: string; roles?: string[]; device_name?: string; device_id?: string; user_id?: string; active?: boolean; entry_id?: string; clock_out?: string; note?: string };
  try { body = await req.json(); } catch { return fail('Invalid request.'); }
  const admin = context.admin;
  if (body.action === 'pair_device') {
    const name = body.device_name?.trim();
    if (!name || name.length > 100) return fail('Enter a device name (up to 100 characters).');
    const token = newStaffToken();
    const { error } = await admin.from('staff_kiosk_devices').insert({ name, secret_hash: staffTokenHash(token), registered_by: context.user.id });
    if (error) return fail('Could not register device. Run the staff timeclock migration.', 503);
    const { error: signoutError } = await (await createServerSupabaseClient()).auth.signOut({ scope: 'local' });
    if (signoutError) return fail('Sign out of this personal session before registering the iPad.', 409);
    const response = NextResponse.json({ ok: true, next: '/staff-login' });
    response.cookies.set(KIOSK_DEVICE_COOKIE, token, { ...kioskCookieOptions, maxAge: 90 * 86400 });
    response.cookies.set(KIOSK_SESSION_COOKIE, '', { ...kioskCookieOptions, maxAge: 0 });
    return response;
  }
  if (body.action === 'revoke_device') {
    if (!uuid(body.device_id)) return fail('Device is required.');
    const { error } = await admin.from('staff_kiosk_devices').update({ active: false }).eq('id', body.device_id);
    return error ? fail('Could not revoke device.', 500) : NextResponse.json({ ok: true });
  }
  if (body.action === 'set_active') {
    if (!uuid(body.user_id) || typeof body.active !== 'boolean') return fail('Employee and active state are required.');
    const { error } = await admin.from('staff_profiles').update({ active: body.active }).eq('user_id', body.user_id);
    return error ? fail('Could not update iPad access.', 500) : NextResponse.json({ ok: true });
  }
  if (body.action === 'close_shift') {
    if (!uuid(body.entry_id) || !body.note?.trim() || body.note.length > 1000 || !body.clock_out) return fail('Choose the open shift, clock-out time and reason.');
    const end = new Date(body.clock_out);
    const { data: entry, error } = await admin.from('staff_time_entries').select('clock_in').eq('id', body.entry_id).is('clock_out', null).maybeSingle();
    if (error || !entry) return fail('Open shift not found.', 404);
    if (!Number.isFinite(end.getTime()) || end.getTime() < new Date(entry.clock_in).getTime() || end.getTime() > Date.now()) return fail('Clock-out must be between clock-in and now.');
    const { data, error: updateError } = await admin.from('staff_time_entries').update({ clock_out: end.toISOString(), closed_by: context.user.id, close_note: body.note.trim() }).eq('id', body.entry_id).is('clock_out', null).select('id');
    if (updateError) return fail('Could not close shift.', 500);
    return data?.length ? NextResponse.json({ ok: true }) : fail('This shift was already closed. Refresh and check the timecard.', 409);
  }
  if (body.action !== 'invite') return fail('Invalid action.');
  const email = body.email?.trim().toLowerCase();
  const name = body.display_name?.trim();
  const roles = [...new Set(body.roles ?? [])];
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !name || name.length > 100 || !roles.length || roles.some(role => !['staff','instructor'].includes(role))) return fail('Enter an email, display name and staff/instructor role.');
  let userId: string | undefined;
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) return fail('Unable to find staff account.', 500);
    userId = data.users.find(user => user.email?.toLowerCase() === email)?.id;
    if (userId || data.users.length < 1000) break;
  }
  let invited = false;
  if (!userId) {
    const origin = new URL(req.headers.get('origin')!).origin;
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo: `${origin}/auth/link?next=/employee` });
    if (error || !data.user) return fail('Invitation could not be sent. Check the email and Supabase email settings.', 502);
    userId = data.user.id; invited = true;
  }
  const { data: primary, error: roleError } = await admin.from('roles').select('role').eq('id', userId).maybeSingle();
  if (roleError) return fail('Unable to update staff access.', 500);
  if (roles.includes('staff') && !['owner','admin','staff'].includes(primary?.role ?? '')) {
    if (primary?.role === 'instructor') {
      const result = await admin.from('user_roles').upsert({ user_id: userId, role: 'instructor' });
      if (result.error) return fail('Could not preserve instructor access.', 500);
    }
    const result = await admin.from('roles').upsert({ id: userId, role: 'staff' });
    if (result.error) return fail('Could not grant staff access.', 500);
  }
  if (roles.includes('instructor')) {
    const result = await admin.from('user_roles').upsert({ user_id: userId, role: 'instructor' });
    if (result.error) return fail('Could not grant instructor access.', 500);
  }
  const { error: saveError } = await admin.from('staff_profiles').upsert({ user_id: userId, display_name: name, active: true, invited_by: context.user.id });
  return saveError ? fail('Could not save staff profile. Run the staff timeclock migration.', 503) : NextResponse.json({ ok: true, invited, message: invited ? 'Invitation sent. They can sign in on their phone and set their PIN.' : 'Existing account added. Ask them to sign in on their phone and set their PIN.' });
}
